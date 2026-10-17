-- JagaSekitar core schema. Geo columns use geography (SRID 4326, metres for distances).
create extension if not exists postgis with schema extensions;
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('user', 'hospital_staff', 'admin');
create type public.app_language as enum ('en', 'ms');
create type public.facility_type as enum ('hospital', 'clinic');
create type public.request_status as enum ('pending', 'approved', 'rejected');
create type public.report_status as enum ('submitted', 'verified', 'rejected');
create type public.hazard_type as enum ('haze', 'flood', 'disease');
create type public.risk_level as enum ('none', 'low', 'moderate', 'high', 'severe');
create type public.water_status as enum ('normal', 'alert', 'warning', 'danger');
create type public.run_status as enum ('running', 'success', 'partial', 'failed');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Adds created_at/updated_at handling to a table that already has both columns.
create or replace function public.add_updated_at_trigger(tbl regclass)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()',
    tbl
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference geography
-- ---------------------------------------------------------------------------
create table public.districts (
  id serial primary key,
  state text not null,                    -- state code, e.g. PRK
  name text not null,
  population integer,                     -- for cases per 100k
  centroid geography(Point, 4326),
  geom geography(MultiPolygon, 4326),     -- filled from geoBoundaries ADM2 (see seed README)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (state, name)
);
create index districts_geom_idx on public.districts using gist (geom);

-- ---------------------------------------------------------------------------
-- People and facilities
-- ---------------------------------------------------------------------------
create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.facility_type not null,
  state text not null,
  district text not null,
  location geography(Point, 4326),
  verified boolean not null default false,
  active boolean not null default true,
  contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, district)
);
create index facilities_location_idx on public.facilities using gist (location);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'user',
  full_name text,
  phone text,
  preferred_language public.app_language not null default 'en',
  facility_id uuid references public.facilities (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.facility_join_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  facility_id uuid references public.facilities (id) on delete cascade,
  proposed_facility jsonb,                -- {name, type, state, district, contact} when facility is new
  message text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (facility_id is not null or proposed_facility is not null)
);

-- ---------------------------------------------------------------------------
-- Haze inputs
-- ---------------------------------------------------------------------------
create table public.fire_hotspots (
  id bigint generated always as identity primary key,
  source text not null,                   -- VIIRS_SNPP_NRT | VIIRS_NOAA20_NRT | MODIS_NRT | demo
  lat double precision not null,
  lon double precision not null,
  geom geography(Point, 4326) generated always as
    (st_setsrid(st_makepoint(lon, lat), 4326)::geography) stored,
  brightness double precision,
  frp double precision,                   -- fire radiative power (MW)
  confidence text,                        -- VIIRS: l/n/h, MODIS: 0–100
  acquired_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, lat, lon, acquired_at)
);
create index fire_hotspots_acquired_idx on public.fire_hotspots (acquired_at desc);
create index fire_hotspots_geom_idx on public.fire_hotspots using gist (geom);

create table public.weather_grid (
  id bigint generated always as identity primary key,
  lat double precision not null,
  lon double precision not null,
  valid_at timestamptz not null,
  wind_speed_10m double precision,        -- km/h
  wind_dir_10m double precision,          -- degrees, direction wind comes FROM
  wind_speed_850 double precision,
  wind_dir_850 double precision,
  precip double precision,                -- mm
  precip_prob double precision,           -- %
  pm2_5 double precision,                 -- µg/m³ (Open-Meteo air quality)
  pm10 double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lat, lon, valid_at)
);
create index weather_grid_valid_idx on public.weather_grid (valid_at);

-- ---------------------------------------------------------------------------
-- Flood inputs (JPS Public Infobanjir)
-- ---------------------------------------------------------------------------
create table public.rain_stations (
  station_id text primary key,
  name text not null,
  state text not null,
  district text,
  geom geography(Point, 4326),
  coords_source text not null default 'seed',  -- seed | nominatim | admin
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rain_stations_geom_idx on public.rain_stations using gist (geom);

create table public.rain_readings (
  id bigint generated always as identity primary key,
  station_id text not null references public.rain_stations (station_id) on delete cascade,
  observed_at timestamptz not null,
  rain_1h double precision,
  rain_since_midnight double precision,
  rain_day_minus_1 double precision,
  rain_day_minus_2 double precision,
  rain_day_minus_3 double precision,
  rain_day_minus_4 double precision,
  rain_day_minus_5 double precision,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (station_id, observed_at)
);
create index rain_readings_station_time_idx on public.rain_readings (station_id, observed_at desc);

create table public.water_level_stations (
  station_id text primary key,
  name text not null,
  river text,
  state text not null,
  district text,
  geom geography(Point, 4326),
  coords_source text not null default 'seed',
  normal_level double precision,          -- metres
  alert_level double precision,
  warning_level double precision,
  danger_level double precision,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index water_level_stations_geom_idx on public.water_level_stations using gist (geom);

create table public.water_level_readings (
  id bigint generated always as identity primary key,
  station_id text not null references public.water_level_stations (station_id) on delete cascade,
  observed_at timestamptz not null,
  level double precision not null,
  status public.water_status not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (station_id, observed_at)
);
create index water_level_readings_station_time_idx
  on public.water_level_readings (station_id, observed_at desc);

create table public.official_alerts (
  id bigint generated always as identity primary key,
  source text not null default 'jps',
  station_id text,
  state text,
  district text,
  title text not null,
  level public.risk_level not null,
  issued_at timestamptz not null,
  expires_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Disease reporting (aggregate counts only — no patient data)
-- ---------------------------------------------------------------------------
create table public.disease_types (
  code text primary key,
  name_en text not null,
  name_ms text not null,
  category text not null,                 -- water | vector | respiratory | contact
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.case_reports (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  disease_code text not null references public.disease_types (code),
  report_date date not null,
  new_cases integer not null check (new_cases between 0 and 10000),
  suspected_cases integer not null default 0 check (suspected_cases between 0 and 10000),
  notes text check (notes is null or char_length(notes) <= 500),
  submitted_by uuid references auth.users (id),
  status public.report_status not null default 'submitted',
  flagged boolean not null default false, -- spike warning or late edit awaiting admin review
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, disease_code, report_date)
);
comment on table public.case_reports is
  'Aggregated daily case counts per facility and disease. Never store patient names, IC numbers or other personal data.';
-- Best-effort guard against personal identifiers in free-text notes:
-- Malaysian IC (YYMMDD-PB-####) and long digit runs (phone/IC without dashes).
alter table public.case_reports add constraint case_reports_notes_no_ic check (
  notes is null or (notes !~ '\d{6}-?\d{2}-?\d{4}' and notes !~ '\d{9,}')
);
create index case_reports_date_idx on public.case_reports (report_date desc);
create index case_reports_facility_idx on public.case_reports (facility_id, report_date desc);

-- ---------------------------------------------------------------------------
-- Predictions
-- ---------------------------------------------------------------------------
create table public.prediction_runs (
  id uuid primary key default gen_random_uuid(),
  hazard public.hazard_type not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.run_status not null default 'running',
  stats jsonb not null default '{}'::jsonb,
  error text,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hazard_zones (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.prediction_runs (id) on delete cascade,
  hazard public.hazard_type not null,
  level public.risk_level not null,
  geom geography(MultiPolygon, 4326) not null,
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  confidence real not null check (confidence between 0 and 1),
  reason_en text not null,
  reason_ms text,
  source_refs jsonb not null default '[]'::jsonb,
  district text,                          -- set for disease zones
  disease_code text references public.disease_types (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to > valid_from)
);
create index hazard_zones_geom_idx on public.hazard_zones using gist (geom);
create index hazard_zones_validity_idx on public.hazard_zones (hazard, valid_to);

-- ---------------------------------------------------------------------------
-- Users' devices, places, notifications
-- ---------------------------------------------------------------------------
create table public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null unique,
  platform text,
  last_lat double precision,              -- last known location only, no history (PDPA)
  last_lon double precision,
  last_geom geography(Point, 4326) generated always as (
    case when last_lat is null or last_lon is null then null
    else st_setsrid(st_makepoint(last_lon, last_lat), 4326)::geography end
  ) stored,
  last_seen_at timestamptz,
  notify_haze boolean not null default true,
  notify_flood boolean not null default true,
  notify_disease boolean not null default true,
  min_level public.risk_level not null default 'moderate',
  quiet_start time,
  quiet_end time,
  language public.app_language not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_devices_geom_idx on public.user_devices using gist (last_geom);

create table public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  geom geography(Point, 4326) not null,
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_places_geom_idx on public.saved_places using gist (geom);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  device_id uuid references public.user_devices (id) on delete cascade,
  hazard public.hazard_type,
  level public.risk_level not null,
  zone_id uuid references public.hazard_zones (id) on delete set null,
  broadcast_id uuid,
  title text not null,
  body text not null,
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notifications_dedupe_idx on public.notifications (device_id, hazard, sent_at desc);

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_broadcasts (
  id uuid primary key default gen_random_uuid(),
  title_en text not null,
  title_ms text,
  body_en text not null,
  body_ms text,
  level public.risk_level not null,
  target_geom geography(MultiPolygon, 4326),
  target_districts text[],
  created_by uuid references auth.users (id),
  sent_at timestamptz,
  recipient_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_geom is not null or target_districts is not null)
);
alter table public.notifications
  add constraint notifications_broadcast_fk
  foreign key (broadcast_id) references public.admin_broadcasts (id) on delete set null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users (id),
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.data_source_status (
  source text primary key,                -- firms | open_meteo | open_meteo_aq | infobanjir_rain | ...
  enabled boolean not null default true,
  refresh_minutes integer not null,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_record_count integer,
  last_payload jsonb,                     -- trimmed sample for the admin "view raw" panel
  used_mock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at triggers on every table
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
    perform public.add_updated_at_trigger(('public.' || t)::regclass);
  end loop;
end;
$$;

-- New auth users get a profile with the default 'user' role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
