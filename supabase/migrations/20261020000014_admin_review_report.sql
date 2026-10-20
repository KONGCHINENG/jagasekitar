-- Admin → Case reports → Verify / Reject failed with "permission denied for table case_reports":
-- the authenticated role may only update (new_cases, suspected_cases, notes, flagged), so staff
-- can never change a report's status. Admins review through this function instead, like the
-- other admin actions (assert_admin first, then act as the table owner).
create or replace function public.admin_review_report(p_report uuid, p_status public.report_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();
  if p_status not in ('verified', 'rejected') then
    raise exception 'A report can only be verified or rejected';
  end if;
  update public.case_reports
     set status = p_status,
         flagged = false
   where id = p_report;
  if not found then raise exception 'Report not found'; end if;
end;
$$;

revoke execute on function public.admin_review_report(uuid, public.report_status) from public, anon;
grant execute on function public.admin_review_report(uuid, public.report_status) to authenticated;
