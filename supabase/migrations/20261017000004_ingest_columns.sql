-- Columns the Infobanjir adapters provide and the flood engine needs.
set search_path = public, extensions;

alter table public.rain_readings
  add column rain_3h double precision,
  add column rain_6h double precision,
  add column rain_24h double precision,
  add column rain_72h double precision;

alter table public.water_level_stations
  add column basin text;

alter table public.water_level_readings
  add column trend text check (trend in ('rising', 'falling', 'steady'));

-- Open-Meteo free tier is ~10k location-calls/day: refresh the wide wind grid every 3 h.
update public.data_source_status set refresh_minutes = 180 where source in ('open_meteo', 'open_meteo_aq');
update public.settings
  set value = value || '{"open_meteo": 180, "open_meteo_aq": 180}'::jsonb
  where key = 'refresh_minutes';

-- Station-level forecast rain for Perak (fine grid) is its own source, refreshed hourly.
insert into public.data_source_status (source, refresh_minutes) values ('open_meteo_local', 60)
on conflict (source) do nothing;

-- Keep weather_grid small: the worker prunes rows older than this many hours.
insert into public.settings (key, value, description) values
  ('retention_hours', '{"weather_grid": 6, "fire_hotspots": 168, "rain_readings": 168, "water_level_readings": 168}',
   'How long the worker keeps raw ingested rows')
on conflict (key) do nothing;
