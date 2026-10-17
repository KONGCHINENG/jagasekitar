-- Read-only map layers for the user app (public data only).
set search_path = public, extensions;

-- Latest reading per active rain station, with coordinates.
create or replace view public.v_rain_stations_latest as
select distinct on (s.station_id)
  s.station_id,
  s.name,
  s.state,
  s.district,
  st_y(s.geom::geometry) as lat,
  st_x(s.geom::geometry) as lon,
  s.coords_source,
  r.observed_at,
  r.rain_1h,
  r.rain_3h,
  r.rain_24h,
  r.rain_since_midnight,
  coalesce((r.raw ->> 'mock')::boolean, false) as simulated
from public.rain_stations s
join public.rain_readings r on r.station_id = s.station_id
where s.active and s.geom is not null
order by s.station_id, r.observed_at desc;

create or replace view public.v_water_stations_latest as
select distinct on (s.station_id)
  s.station_id,
  s.name,
  s.river,
  s.basin,
  s.state,
  s.district,
  st_y(s.geom::geometry) as lat,
  st_x(s.geom::geometry) as lon,
  s.coords_source,
  s.normal_level,
  s.alert_level,
  s.warning_level,
  s.danger_level,
  r.observed_at,
  r.level,
  r.status,
  r.trend,
  coalesce((r.raw ->> 'mock')::boolean, false) as simulated
from public.water_level_stations s
join public.water_level_readings r on r.station_id = s.station_id
where s.active and s.geom is not null
order by s.station_id, r.observed_at desc;

-- Fire hotspots of the last 48 h binned to 0.1° cells (one fire icon per cell).
create or replace view public.v_hotspot_cells as
select
  round(lat::numeric, 1)::double precision as lat,
  round(lon::numeric, 1)::double precision as lon,
  count(*)::integer as hotspots,
  round(sum(coalesce(frp, 0))::numeric, 1)::double precision as frp_sum,
  max(acquired_at) as last_seen,
  bool_or(source = 'mock') as simulated
from public.fire_hotspots
where acquired_at > now() - interval '48 hours'
group by 1, 2;

-- Wind arrows: the forecast hour closest to p_at, on whole-degree grid points in the bbox.
create or replace function public.map_wind(
  p_at timestamptz default now(),
  west double precision default 95,
  south double precision default -6,
  east double precision default 110,
  north double precision default 8
)
returns table (lat double precision, lon double precision, speed double precision, dir_from double precision, valid_at timestamptz)
language sql
stable
set search_path = public, extensions
as $$
  with t as (
    select valid_at from public.weather_grid
    where wind_dir_850 is not null or wind_dir_10m is not null
    order by abs(extract(epoch from valid_at - p_at)) limit 1
  )
  select w.lat, w.lon,
    coalesce(w.wind_speed_850, w.wind_speed_10m),
    coalesce(w.wind_dir_850, w.wind_dir_10m),
    w.valid_at
  from public.weather_grid w, t
  where w.valid_at = t.valid_at
    and (w.wind_dir_850 is not null or w.wind_dir_10m is not null)
    and w.lat = round(w.lat) and w.lon = round(w.lon)
    and w.lon between west and east and w.lat between south and north;
$$;

-- PM2.5 forecast nearest to a point and time (for the haze legend).
create or replace function public.pm25_at(lat double precision, lon double precision, p_at timestamptz default now())
returns table (pm2_5 double precision, valid_at timestamptz, distance_km double precision)
language sql
stable
set search_path = public, extensions
as $$
  select w.pm2_5, w.valid_at,
    st_distance(st_makepoint(w.lon, w.lat)::geography, st_makepoint(pm25_at.lon, pm25_at.lat)::geography) / 1000
  from public.weather_grid w
  where w.pm2_5 is not null
    and abs(w.lat - pm25_at.lat) <= 0.5 and abs(w.lon - pm25_at.lon) <= 0.5
  order by abs(extract(epoch from w.valid_at - p_at)), (w.lat - pm25_at.lat) ^ 2 + (w.lon - pm25_at.lon) ^ 2
  limit 1;
$$;

grant select on public.v_rain_stations_latest, public.v_water_stations_latest, public.v_hotspot_cells
  to anon, authenticated;
grant execute on function public.map_wind(timestamptz, double precision, double precision, double precision, double precision)
  to anon, authenticated;
grant execute on function public.pm25_at(double precision, double precision, timestamptz) to anon, authenticated;
