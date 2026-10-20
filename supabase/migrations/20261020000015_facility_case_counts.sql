-- Illness map pins showed the number of reports in 7 days, so a report corrected to 0 cases still
-- showed "1". Add the 7-day confirmed-case total (aggregate, no patient data) for the pin number.
-- New columns go at the end so CREATE OR REPLACE VIEW keeps the existing ones.
set search_path = public, extensions;
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
  max(r.report_date) as last_report_date,
  coalesce(sum(r.new_cases) filter (where r.report_date > current_date - 7), 0)::integer as cases_7d
from public.facilities f
left join public.case_reports r on r.facility_id = f.id and r.status <> 'rejected'
where f.verified and f.active
group by f.id;
