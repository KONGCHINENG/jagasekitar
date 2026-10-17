-- Phase 6: device registration, saved places, and the notification job.
set search_path = public, extensions;

-- A device is identified by a per-install id; the Expo push token is optional (Expo Go on Android
-- can't get one, and those devices still get in-app alerts over Realtime).
alter table public.user_devices alter column expo_push_token drop not null;
alter table public.user_devices
  add column install_id text unique,
  add column background_location boolean not null default false,
  add column notify_saved_places boolean not null default true;

alter table public.notifications
  add column delivery text not null default 'in_app' check (delivery in ('push', 'in_app')),
  add column zone_key text,
  add column place_id uuid references public.saved_places (id) on delete set null,
  add column data jsonb not null default '{}'::jsonb;
create index notifications_device_zone_idx on public.notifications (device_id, hazard, zone_key, sent_at desc);

-- Saved places with coordinates, through RLS (security_invoker): users see only their own.
create or replace view public.v_my_places
with (security_invoker = true) as
select id, label, notify, st_y(geom::geometry) as lat, st_x(geom::geometry) as lon, created_at
from public.saved_places;
grant select on public.v_my_places to authenticated;

-- Places can be added with lat/lon instead of a geography literal.
create or replace function public.save_place(p_label text, p_lat double precision, p_lon double precision, p_notify boolean default true)
returns uuid
language sql
security invoker
set search_path = public, extensions
as $$
  insert into public.saved_places (user_id, label, geom, notify)
  values (auth.uid(), p_label, st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography, p_notify)
  returning id;
$$;
grant execute on function public.save_place(text, double precision, double precision, boolean) to authenticated;

-- Who is inside which zone right now (or within the next 24 h for haze forecasts)?
-- One row per (device or saved place) × zone. Service role only.
create or replace function public.notify_candidates(p_horizon_hours integer default 24, p_seen_days integer default 7)
returns table (
  device_id uuid,
  user_id uuid,
  expo_push_token text,
  language public.app_language,
  min_level public.risk_level,
  quiet_start time,
  quiet_end time,
  notify_haze boolean,
  notify_flood boolean,
  notify_disease boolean,
  place_id uuid,
  place_label text,
  zone_id uuid,
  zone_key text,
  hazard public.hazard_type,
  level public.risk_level,
  valid_from timestamptz,
  district text,
  reason_en text,
  reason_ms text,
  lat double precision,
  lon double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with zones as (
    select * from public.hazard_zones z
    where z.valid_to > now() and z.valid_from < now() + make_interval(hours => p_horizon_hours)
  ),
  devices as (
    select * from public.user_devices d
    where d.last_seen_at > now() - make_interval(days => p_seen_days)
  )
  -- Device's last known location
  select d.id, d.user_id, d.expo_push_token, d.language, d.min_level, d.quiet_start, d.quiet_end,
         d.notify_haze, d.notify_flood, d.notify_disease,
         null::uuid, null::text,
         z.id, z.zone_key, z.hazard, z.level, z.valid_from, z.district, z.reason_en, z.reason_ms,
         d.last_lat, d.last_lon
  from devices d
  join zones z on d.last_geom is not null and st_intersects(z.geom, d.last_geom)
  union all
  -- The device owner's saved places that ask for alerts
  select d.id, d.user_id, d.expo_push_token, d.language, d.min_level, d.quiet_start, d.quiet_end,
         d.notify_haze, d.notify_flood, d.notify_disease,
         p.id, p.label,
         z.id, z.zone_key, z.hazard, z.level, z.valid_from, z.district, z.reason_en, z.reason_ms,
         st_y(p.geom::geometry), st_x(p.geom::geometry)
  from devices d
  join public.saved_places p on p.user_id = d.user_id and p.notify and d.notify_saved_places
  join zones z on st_intersects(z.geom, p.geom);
$$;
revoke execute on function public.notify_candidates(integer, integer) from public, anon, authenticated;
grant execute on function public.notify_candidates(integer, integer) to service_role;

-- In-app alerts: the app listens for its own new notification rows (RLS still applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
