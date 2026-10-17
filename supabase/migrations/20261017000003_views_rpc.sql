-- Read models for the apps. Views run with the owner's rights (security_invoker = false) on
-- purpose: they expose only district-level aggregates or public hazard data, never raw reports.
set search_path = public, extensions;

-- Active zones (not yet expired).
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
  st_asgeojson(st_simplifypreservetopology(z.geom::geometry, 0.002), 5)::jsonb as geometry
from public.hazard_zones z
where z.valid_to > now();

-- District disease summary: last 7 days vs. the previous 28-day daily baseline.
create or replace view public.v_disease_district_summary as
with daily as (
  select
    f.state,
    f.district,
    r.disease_code,
    r.report_date,
    sum(r.new_cases)::integer as cases,
    sum(r.suspected_cases)::integer as suspected
  from public.case_reports r
  join public.facilities f on f.id = r.facility_id
  where r.status <> 'rejected'
    and r.report_date > current_date - 35
  group by f.state, f.district, r.disease_code, r.report_date
),
agg as (
  select
    state,
    district,
    disease_code,
    coalesce(sum(cases) filter (where report_date > current_date - 7), 0)::integer as cases_7d,
    coalesce(sum(suspected) filter (where report_date > current_date - 7), 0)::integer as suspected_7d,
    coalesce(sum(cases) filter (where report_date <= current_date - 7), 0)::integer as cases_prev_28d,
    -- 14-day daily series for sparklines, oldest first
    (
      select coalesce(jsonb_agg(coalesce(d2.cases, 0) order by g.day), '[]'::jsonb)
      from generate_series(current_date - 13, current_date, interval '1 day') as g(day)
      left join daily d2
        on d2.state = daily.state and d2.district = daily.district
        and d2.disease_code = daily.disease_code and d2.report_date = g.day::date
    ) as trend_14d
  from daily
  group by state, district, disease_code
)
select
  a.state,
  a.district,
  a.disease_code,
  t.name_en as disease_name_en,
  t.name_ms as disease_name_ms,
  a.cases_7d,
  a.suspected_7d,
  a.cases_prev_28d,
  -- Expected 7-day count from the 28-day baseline; ratio is null when there is no baseline.
  round(a.cases_prev_28d / 4.0, 2) as baseline_7d,
  case when a.cases_prev_28d > 0
    then round(a.cases_7d / (a.cases_prev_28d / 4.0), 2) end as baseline_ratio,
  case when d.population > 0
    then round(a.cases_7d * 100000.0 / d.population, 2) end as per_100k,
  d.population,
  a.trend_14d
from agg a
join public.disease_types t on t.code = a.disease_code
left join public.districts d on d.state = a.state and d.name = a.district;

-- Per-facility report counts for the Illness Map pins (number of reports, not patients).
create or replace view public.v_facility_report_counts as
select
  f.id as facility_id,
  f.name,
  f.type,
  f.state,
  f.district,
  st_y(f.location::geometry) as lat,
  st_x(f.location::geometry) as lon,
  count(r.id) filter (where r.report_date > current_date - 7)::integer as reports_7d,
  max(r.report_date) as last_report_date
from public.facilities f
left join public.case_reports r on r.facility_id = f.id and r.status <> 'rejected'
where f.verified and f.active
group by f.id;

-- Freshness of each data source, for "Last updated" and stale-data banners.
create or replace view public.v_data_freshness as
select source, enabled, last_success_at, last_error_at, used_mock
from public.data_source_status;

-- Districts as simplified GeoJSON for choropleths.
create or replace view public.v_districts_geojson as
select
  id,
  state,
  name,
  population,
  st_y(centroid::geometry) as centroid_lat,
  st_x(centroid::geometry) as centroid_lon,
  case when geom is null then null
    else st_asgeojson(st_simplifypreservetopology(geom::geometry, 0.002), 5)::jsonb end as geometry
from public.districts;

grant select on
  public.v_active_zones,
  public.v_disease_district_summary,
  public.v_facility_report_counts,
  public.v_data_freshness,
  public.v_districts_geojson
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: active zones intersecting the map viewport, as simplified GeoJSON.
-- ---------------------------------------------------------------------------
create or replace function public.zones_in_bbox(
  west double precision,
  south double precision,
  east double precision,
  north double precision,
  hazard_filter public.hazard_type default null,
  at_time timestamptz default now(),
  tolerance double precision default 0.002
)
returns table (
  id uuid,
  hazard public.hazard_type,
  level public.risk_level,
  valid_from timestamptz,
  valid_to timestamptz,
  confidence real,
  reason_en text,
  reason_ms text,
  source_refs jsonb,
  district text,
  disease_code text,
  geometry jsonb
)
language sql
stable
set search_path = public, extensions
as $$
  select
    z.id, z.hazard, z.level, z.valid_from, z.valid_to, z.confidence,
    z.reason_en, z.reason_ms, z.source_refs, z.district, z.disease_code,
    st_asgeojson(st_simplifypreservetopology(z.geom::geometry, tolerance), 5)::jsonb
  from public.hazard_zones z
  where (hazard_filter is null or z.hazard = hazard_filter)
    and z.valid_from <= at_time
    and z.valid_to > at_time
    and st_intersects(z.geom, st_makeenvelope(west, south, east, north, 4326)::geography)
  order by z.level desc;
$$;
grant execute on function public.zones_in_bbox to anon, authenticated;

-- RPC: which district a point falls in (falls back to the nearest centroid
-- while district polygons are not loaded yet).
create or replace function public.district_at(lat double precision, lon double precision)
returns table (state text, name text, population integer)
language sql
stable
set search_path = public, extensions
as $$
  with p as (select st_setsrid(st_makepoint(lon, lat), 4326)::geography as g)
  select d.state, d.name, d.population
  from public.districts d, p
  order by
    case when d.geom is not null and st_intersects(d.geom, p.g) then 0 else 1 end,
    st_distance(coalesce(d.centroid, d.geom), p.g)
  limit 1;
$$;
grant execute on function public.district_at to anon, authenticated;
