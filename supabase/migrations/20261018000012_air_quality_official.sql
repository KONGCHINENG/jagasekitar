-- WAQI mixes official monitors (DOE and other agencies; positive station ids) with community
-- sensors (negative ids). Only official readings may create haze zones; sensors are shown, labelled.
set search_path = public, extensions;

alter table public.air_quality_obs add column official boolean not null default true;

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
  source = 'mock' as simulated,
  official
from public.air_quality_obs;
grant select on public.v_air_quality_latest to anon, authenticated;
