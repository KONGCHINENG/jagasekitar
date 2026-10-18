-- More data for accuracy (DATA_ACCURACY.md quick wins):
--  * MetMalaysia weather warnings (data.gov.my) → official_alerts rows with source 'metmalaysia'
--  * GloFAS river discharge forecasts (Open-Meteo Flood API) per JPS river gauge
--  * WAQI measured air quality (DOE stations) for the haze map
set search_path = public, extensions;

-- One row per river gauge: the forecast peak over the next days against the recent median.
create table public.river_flow_forecasts (
  station_id text primary key references public.water_level_stations (station_id) on delete cascade,
  cell_lat double precision not null,     -- GloFAS grid cell actually used (~5 km)
  cell_lon double precision not null,
  baseline_median real not null,          -- m³/s, median of the past 92 days
  peak real not null,                     -- m³/s, highest forecast day in the lookahead window
  peak_date date not null,
  ratio real not null,                    -- peak / baseline_median
  series jsonb not null,                  -- [{ "date": "2026-10-18", "q": 12.3, "forecast": true }]
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Latest measured air quality per monitoring station.
create table public.air_quality_obs (
  uid text primary key,                   -- '<source>:<station id>'
  source text not null,                   -- waqi | mock
  name text not null,
  geom geography(Point, 4326) not null,
  pm25 real,                              -- µg/m³ (converted from the PM2.5 AQI sub-index)
  aqi integer,                            -- overall US-EPA AQI as published
  observed_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index air_quality_obs_geom_idx on public.air_quality_obs using gist (geom);

alter table public.river_flow_forecasts enable row level security;
alter table public.air_quality_obs enable row level security;
create policy admin_all on public.river_flow_forecasts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.air_quality_obs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy public_read on public.river_flow_forecasts for select to anon, authenticated using (true);
create policy public_read on public.air_quality_obs for select to anon, authenticated using (true);

create or replace view public.v_air_quality_latest
with (security_invoker = true) as
select
  uid,
  source,
  name,
  st_y(geom::geometry) as lat,
  st_x(geom::geometry) as lon,
  pm25,
  aqi,
  observed_at,
  source = 'mock' as simulated
from public.air_quality_obs;
grant select on public.v_air_quality_latest to anon, authenticated;

insert into public.data_source_status (source, refresh_minutes) values
  ('metmalaysia', 30),
  ('glofas', 360),
  ('waqi', 60)
on conflict (source) do nothing;
