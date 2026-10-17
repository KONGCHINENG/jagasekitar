-- Row Level Security. The worker uses the service_role key, which bypasses RLS.
-- Anonymous app users sign in with Supabase anonymous auth, so auth.uid() is always set
-- for device/place/notification rows.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so policies can read profiles without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid() and active),
    'user'::public.user_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role() = 'admin';
$$;

-- The facility a hospital staff member may report for: only their own, verified, active facility.
create or replace function public.staff_facility_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.facility_id
  from public.profiles p
  join public.facilities f on f.id = p.facility_id
  where p.id = auth.uid()
    and p.active
    and p.role = 'hospital_staff'
    and f.verified
    and f.active;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'districts', 'facilities', 'profiles', 'facility_join_requests', 'fire_hotspots',
    'weather_grid', 'rain_stations', 'rain_readings', 'water_level_stations',
    'water_level_readings', 'official_alerts', 'disease_types', 'case_reports',
    'prediction_runs', 'hazard_zones', 'user_devices', 'saved_places', 'notifications',
    'settings', 'admin_broadcasts', 'audit_log', 'data_source_status'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- Admins can do everything on every table.
    execute format(
      'create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public read: hazard outputs, station data, reference tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'districts', 'fire_hotspots', 'weather_grid', 'rain_stations', 'rain_readings',
    'water_level_stations', 'water_level_readings', 'official_alerts', 'disease_types',
    'hazard_zones', 'settings'
  ] loop
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end;
$$;

-- Facilities: everyone sees verified, active facilities (name and location only matter here).
create policy public_read_verified on public.facilities
  for select to anon, authenticated
  using (verified and active);
-- Staff also see their own facility even before it is verified.
create policy staff_read_own on public.facilities
  for select to authenticated
  using (id = (select facility_id from public.profiles where id = auth.uid()));

-- Broadcast alerts are public once sent (shown in the Alerts tab).
create policy public_read_sent on public.admin_broadcasts
  for select to anon, authenticated
  using (sent_at is not null);

-- ---------------------------------------------------------------------------
-- Profiles: users read their own; may only edit name, phone and language.
-- ---------------------------------------------------------------------------
create policy own_read on public.profiles
  for select to authenticated
  using (id = auth.uid());
create policy own_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, preferred_language) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Facility join requests
-- ---------------------------------------------------------------------------
create policy own_read on public.facility_join_requests
  for select to authenticated
  using (user_id = auth.uid());
create policy own_insert on public.facility_join_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);

-- ---------------------------------------------------------------------------
-- Case reports: staff only for their own verified facility.
-- ---------------------------------------------------------------------------
create policy staff_read_own on public.case_reports
  for select to authenticated
  using (facility_id = public.staff_facility_id());
create policy staff_insert_own on public.case_reports
  for insert to authenticated
  with check (
    facility_id = public.staff_facility_id()
    and submitted_by = auth.uid()
    and status = 'submitted'
  );
-- Direct edits only within 48 h of submission; later edits go to admin review (Phase 7).
create policy staff_update_recent on public.case_reports
  for update to authenticated
  using (
    facility_id = public.staff_facility_id()
    and status = 'submitted'
    and created_at > now() - interval '48 hours'
  )
  with check (
    facility_id = public.staff_facility_id()
    and status = 'submitted'
  );
revoke update on public.case_reports from authenticated, anon;
grant update (new_cases, suspected_cases, notes, flagged) on public.case_reports to authenticated;

-- Rate limit: at most 300 case-report inserts per user per hour.
create or replace function public.case_reports_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and (
    select count(*) from public.case_reports
    where submitted_by = auth.uid() and created_at > now() - interval '1 hour'
  ) >= 300 then
    raise exception 'Too many case reports submitted in the last hour. Please try again later.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger case_reports_rate_limit
  before insert on public.case_reports
  for each row execute function public.case_reports_rate_limit();

-- ---------------------------------------------------------------------------
-- Users' own data
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['user_devices', 'saved_places'] loop
    execute format(
      'create policy own_all on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end;
$$;

create policy own_read on public.notifications
  for select to authenticated
  using (user_id = auth.uid());
-- Users may only mark their notifications as opened.
create policy own_mark_opened on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
revoke update on public.notifications from authenticated, anon;
grant update (opened_at) on public.notifications to authenticated;

-- "Delete my data" (PDPA): removes the caller's devices, places, notifications and join requests.
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  delete from public.notifications where user_id = uid;
  delete from public.saved_places where user_id = uid;
  delete from public.user_devices where user_id = uid;
  delete from public.facility_join_requests where user_id = uid and status = 'pending';
end;
$$;
revoke execute on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log: record changes to sensitive tables with the acting user.
-- ---------------------------------------------------------------------------
create or replace function public.audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_id text;
  change jsonb;
begin
  if tg_op = 'DELETE' then
    row_id := coalesce(to_jsonb(old) ->> 'id', to_jsonb(old) ->> 'key', to_jsonb(old) ->> 'station_id');
    change := jsonb_build_object('old', to_jsonb(old));
  else
    row_id := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'key', to_jsonb(new) ->> 'station_id');
    change := case when tg_op = 'UPDATE'
      then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      else jsonb_build_object('new', to_jsonb(new)) end;
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, diff)
  values (auth.uid(), lower(tg_op), tg_table_name, row_id, change);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'facilities', 'facility_join_requests', 'case_reports', 'settings',
    'admin_broadcasts', 'rain_stations', 'water_level_stations', 'disease_types'
  ] loop
    execute format(
      'create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.audit_changes()',
      t
    );
  end loop;
end;
$$;
