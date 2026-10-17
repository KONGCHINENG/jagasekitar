-- Hospital portal: edits to case reports older than 48 h go to an admin for approval.
set search_path = public, extensions;

create table public.case_report_edits (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.case_reports (id) on delete cascade,
  requested_by uuid not null references auth.users (id),
  new_cases integer not null check (new_cases between 0 and 10000),
  suspected_cases integer not null check (suspected_cases between 0 and 10000),
  notes text check (notes is null or (char_length(notes) <= 500 and notes !~ '\d{6}-?\d{2}-?\d{4}' and notes !~ '\d{9,}')),
  reason text not null check (char_length(reason) between 3 and 500),
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index case_report_edits_status_idx on public.case_report_edits (status, created_at desc);
select public.add_updated_at_trigger('public.case_report_edits'::regclass);

alter table public.case_report_edits enable row level security;
create policy admin_all on public.case_report_edits
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read_own_facility on public.case_report_edits
  for select to authenticated
  using (exists (
    select 1 from public.case_reports r
    where r.id = report_id and r.facility_id = public.staff_facility_id()
  ));
create policy staff_request on public.case_report_edits
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and status = 'pending'
    and reviewed_by is null
    and exists (
      select 1 from public.case_reports r
      where r.id = report_id and r.facility_id = public.staff_facility_id()
    )
  );

create trigger audit_changes after insert or update or delete on public.case_report_edits
  for each row execute function public.audit_changes();

-- What the portal needs to know about the signed-in user, in one call (RLS-safe: own row only).
create or replace function public.my_portal_profile()
returns table (
  user_id uuid,
  role public.user_role,
  full_name text,
  facility_id uuid,
  facility_name text,
  facility_district text,
  facility_state text,
  facility_verified boolean,
  pending_request boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.role, p.full_name, f.id, f.name, f.district, f.state, f.verified,
    exists (select 1 from public.facility_join_requests j where j.user_id = p.id and j.status = 'pending')
  from public.profiles p
  left join public.facilities f on f.id = p.facility_id
  where p.id = auth.uid() and p.active;
$$;
revoke execute on function public.my_portal_profile() from public, anon;
grant execute on function public.my_portal_profile() to authenticated;
