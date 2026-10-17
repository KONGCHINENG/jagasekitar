-- Prediction-engine plumbing: compact input queries and atomic zone replacement.
-- All functions here are for the worker (service_role) only.
set search_path = public, extensions;

-- Stable engine id per zone ("flood:Kinta:high", "haze:+24h:moderate", "disease:Kinta:DENGUE"),
-- used to dedupe notifications across runs.
alter table public.hazard_zones add column zone_key text;
create index hazard_zones_key_idx on public.hazard_zones (hazard, zone_key);

-- Replace all zones of one hazard with a new run's zones in a single transaction, so the app
-- never sees a half-written set. Geometry is GeoJSON; PostGIS repairs and normalises it.
create or replace function public.replace_hazard_zones(
  p_hazard public.hazard_type,
  p_run_id uuid,
  p_zones jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  z jsonb;
  g geometry;
  n integer := 0;
begin
  delete from public.hazard_zones where hazard = p_hazard;
  for z in select * from jsonb_array_elements(p_zones) loop
    g := st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson(z ->> 'geometry'), 4326)), 3);
    continue when g is null or st_isempty(g);
    insert into public.hazard_zones (
      run_id, hazard, level, geom, valid_from, valid_to, confidence,
      reason_en, reason_ms, source_refs, district, disease_code, zone_key
    ) values (
      p_run_id,
      p_hazard,
      (z ->> 'level')::public.risk_level,
      st_multi(g)::geography,
      (z ->> 'validFrom')::timestamptz,
      (z ->> 'validTo')::timestamptz,
      (z ->> 'confidence')::real,
      z ->> 'reason',
      z ->> 'reasonMs',
      coalesce(z -> 'sourceRefs', '[]'::jsonb),
      z ->> 'district',
      z ->> 'diseaseCode',
      z ->> 'id'
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Weather samples as one JSON array (the wind grid alone is ~30k rows, past PostgREST's
-- 1000-row page). Rows are thinned to every `p_step_hours` hours.
create or replace function public.engine_weather(
  p_kind text,                       -- 'wind' | 'pm25' | 'precip'
  p_from timestamptz,
  p_to timestamptz,
  p_step_hours integer default 1,
  p_bbox double precision[] default null  -- [W, S, E, N]
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(
    case p_kind
      when 'wind' then jsonb_build_object(
        'lat', lat, 'lon', lon, 'validAt', valid_at,
        'windSpeed10m', wind_speed_10m, 'windDir10m', wind_dir_10m,
        'windSpeed850', wind_speed_850, 'windDir850', wind_dir_850)
      when 'pm25' then jsonb_build_object('lat', lat, 'lon', lon, 'validAt', valid_at, 'pm25', pm2_5)
      else jsonb_build_object('lat', lat, 'lon', lon, 'validAt', valid_at, 'precip', precip)
    end), '[]'::jsonb)
  from public.weather_grid
  where valid_at >= p_from and valid_at <= p_to
    and extract(hour from valid_at at time zone 'UTC')::int % greatest(p_step_hours, 1) = 0
    and case p_kind
      when 'wind' then wind_dir_850 is not null or wind_dir_10m is not null
      when 'pm25' then pm2_5 is not null
      else precip is not null
    end
    and (p_bbox is null or (lon between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]));
$$;

-- Latest reading per active station, with coordinates.
create or replace function public.engine_rain_latest(p_state text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'stationId', s.station_id, 'name', s.name, 'district', s.district,
    'lat', st_y(s.geom::geometry), 'lon', st_x(s.geom::geometry),
    'observedAt', r.observed_at, 'rain1h', r.rain_1h, 'rain3h', r.rain_3h,
    'rain24h', r.rain_24h, 'rain72h', r.rain_72h)), '[]'::jsonb)
  from public.rain_stations s
  join lateral (
    select * from public.rain_readings rr
    where rr.station_id = s.station_id
    order by rr.observed_at desc limit 1
  ) r on true
  where s.state = p_state and s.active and s.geom is not null;
$$;

create or replace function public.engine_water_latest(p_state text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'stationId', s.station_id, 'name', s.name, 'river', s.river, 'district', s.district,
    'lat', st_y(s.geom::geometry), 'lon', st_x(s.geom::geometry),
    'observedAt', r.observed_at, 'level', r.level, 'status', r.status, 'trend', r.trend)), '[]'::jsonb)
  from public.water_level_stations s
  join lateral (
    select * from public.water_level_readings wr
    where wr.station_id = s.station_id
    order by wr.observed_at desc limit 1
  ) r on true
  where s.state = p_state and s.active and s.geom is not null;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'replace_hazard_zones(public.hazard_type, uuid, jsonb)',
    'engine_weather(text, timestamptz, timestamptz, integer, double precision[])',
    'engine_rain_latest(text)',
    'engine_water_latest(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- Expose the stable key to the app as well.
create or replace view public.v_active_zones as
select
  z.id,
  z.hazard,
  z.level,
  z.valid_from,
  z.valid_to,
  z.confidence,
  z.reason_en,
  z.reason_ms,
  z.source_refs,
  z.district,
  z.disease_code,
  z.run_id,
  z.created_at,
  st_asgeojson(st_simplifypreservetopology(z.geom::geometry, 0.002), 5)::jsonb as geometry,
  z.zone_key
from public.hazard_zones z
where z.valid_to > now();
