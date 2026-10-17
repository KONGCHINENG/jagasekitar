-- Phase 8: admin panel support. Every function here checks is_admin() itself (security definer).
set search_path = public, extensions;

-- "Refresh now" and "Re-run prediction" are requests the worker picks up on its next tick.
alter table public.data_source_status add column refresh_requested_at timestamptz;
insert into public.settings (key, value, description)
values ('worker_requests', '{"predict_at": null}', 'Admin requests for the worker (re-run predictions)')
on conflict (key) do nothing;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
end;
$$;

-- Users with their email (auth.users is not exposed through the API).
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.user_role,
  active boolean,
  facility_id uuid,
  facility_name text,
  is_anonymous boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  perform public.assert_admin();
  return query
    select p.id, u.email::text, p.full_name, p.role, p.active, p.facility_id, f.name,
      coalesce(u.is_anonymous, false), p.created_at, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.facilities f on f.id = p.facility_id
    order by p.role desc, p.created_at desc;
end;
$$;

-- Change a user's role / facility / active flag (profiles.role isn't updatable through the API).
create or replace function public.admin_set_user(
  p_user uuid,
  p_role public.user_role,
  p_facility uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();
  if p_user = auth.uid() and (p_role <> 'admin' or not p_active) then
    raise exception 'You cannot remove your own admin access';
  end if;
  if p_role = 'hospital_staff' and p_facility is null then
    raise exception 'Hospital staff need a facility';
  end if;
  update public.profiles
     set role = p_role,
         facility_id = case when p_role = 'hospital_staff' then p_facility else null end,
         active = p_active
   where id = p_user;
end;
$$;

-- Approve or reject a facility join request. Approving a proposed facility creates it, verified.
create or replace function public.admin_review_join(p_request uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r public.facility_join_requests;
  fid uuid;
begin
  perform public.assert_admin();
  select * into r from public.facility_join_requests where id = p_request for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'Request already reviewed'; end if;

  if p_approve then
    fid := r.facility_id;
    if fid is null then
      insert into public.facilities (name, type, state, district, contact, verified, location)
      values (
        r.proposed_facility ->> 'name',
        coalesce(r.proposed_facility ->> 'type', 'clinic')::public.facility_type,
        coalesce(r.proposed_facility ->> 'state', 'PRK'),
        r.proposed_facility ->> 'district',
        r.proposed_facility ->> 'contact',
        true,
        -- Until an admin pins it, place a new facility at its district centre.
        (select centroid from public.districts d
          where d.state = coalesce(r.proposed_facility ->> 'state', 'PRK') and d.name = r.proposed_facility ->> 'district')
      )
      on conflict (name, district) do update set verified = true
      returning id into fid;
    end if;
    update public.facilities set verified = true where id = fid and not verified;
    update public.profiles set role = 'hospital_staff', facility_id = fid
     where id = r.user_id and role <> 'admin';
  end if;
  update public.facility_join_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         facility_id = coalesce(fid, facility_id),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_request;
end;
$$;

-- Approve (apply) or reject a late edit request on a case report.
create or replace function public.admin_review_edit(p_edit uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare e public.case_report_edits;
begin
  perform public.assert_admin();
  select * into e from public.case_report_edits where id = p_edit for update;
  if e.id is null then raise exception 'Edit request not found'; end if;
  if e.status <> 'pending' then raise exception 'Edit request already reviewed'; end if;
  if p_approve then
    update public.case_reports
       set new_cases = e.new_cases, suspected_cases = e.suspected_cases, notes = e.notes
     where id = e.report_id;
  end if;
  update public.case_report_edits
     set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_edit;
end;
$$;

-- Devices whose last location is inside the chosen districts (for a broadcast).
create or replace function public.broadcast_targets(p_state text, p_districts text[])
returns table (device_id uuid, user_id uuid, expo_push_token text, language public.app_language)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_admin();
  return query
    select d.id, d.user_id, d.expo_push_token, d.language
    from public.user_devices d
    where d.last_geom is not null
      and d.last_seen_at > now() - interval '30 days'
      and exists (
        select 1 from public.districts x
        where x.state = p_state and x.name = any (p_districts) and x.geom is not null
          and st_intersects(x.geom, d.last_geom)
      );
end;
$$;

-- Union of district polygons as a MultiPolygon, stored on the broadcast record.
create or replace function public.districts_union(p_state text, p_districts text[])
returns geography
language sql
stable
set search_path = public, extensions
as $$
  select st_multi(st_union(geom::geometry))::geography
  from public.districts where state = p_state and name = any (p_districts);
$$;

create or replace function public.admin_create_broadcast(
  p_state text,
  p_districts text[],
  p_level public.risk_level,
  p_title_en text,
  p_title_ms text,
  p_body_en text,
  p_body_ms text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare bid uuid;
begin
  perform public.assert_admin();
  if coalesce(array_length(p_districts, 1), 0) = 0 then raise exception 'Choose at least one district'; end if;
  insert into public.admin_broadcasts (title_en, title_ms, body_en, body_ms, level, target_geom, target_districts, created_by)
  values (p_title_en, p_title_ms, p_body_en, p_body_ms, p_level, public.districts_union(p_state, p_districts), p_districts, auth.uid())
  returning id into bid;
  return bid;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'assert_admin()',
    'admin_list_users()',
    'admin_set_user(uuid, public.user_role, uuid, boolean)',
    'admin_review_join(uuid, boolean)',
    'admin_review_edit(uuid, boolean)',
    'broadcast_targets(text, text[])',
    'admin_create_broadcast(text, text[], public.risk_level, text, text, text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- Admin "station" list with coordinates for the stations map.
create or replace view public.v_stations_admin as
select 'rain'::text as kind, station_id, name, null::text as river, state, district, active, coords_source,
  st_y(geom::geometry) as lat, st_x(geom::geometry) as lon
from public.rain_stations
union all
select 'water_level', station_id, name, river, state, district, active, coords_source,
  st_y(geom::geometry), st_x(geom::geometry)
from public.water_level_stations;
grant select on public.v_stations_admin to authenticated;
