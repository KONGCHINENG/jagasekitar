import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireReportingStaff } from '@/lib/auth';
import { todayMyt } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';
import { HistoryTable, type HistoryRow } from './history-table';

export const metadata = { title: 'History · Hospital portal' };

export default function HistoryPage() {
  return (
    <>
      <PageTitle sub="Last 60 days. Edit within 48 hours of submitting; after that, changes go to an admin for approval.">
        History
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-96" />}>
        <HistoryBody />
      </Suspense>
    </>
  );
}

async function HistoryBody() {
  const user = await requireReportingStaff();
  const supabase = await createClient();
  const since = new Date(Date.parse(`${todayMyt()}T00:00:00Z`) - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [{ data: reports }, { data: types }, { data: edits }] = await Promise.all([
    supabase
      .from('case_reports')
      .select(
        'id, report_date, disease_code, new_cases, suspected_cases, notes, status, flagged, created_at',
      )
      .eq('facility_id', user.facility.id)
      .gte('report_date', since)
      .order('report_date', { ascending: false })
      .order('disease_code'),
    supabase.from('disease_types').select('code, name_en'),
    supabase.from('case_report_edits').select('report_id').eq('status', 'pending'),
  ]);
  const names = Object.fromEntries((types ?? []).map((t) => [t.code, t.name_en]));
  const pending = new Set((edits ?? []).map((e) => e.report_id as string));
  const rows: HistoryRow[] = (reports ?? []).map((r) => ({
    id: r.id,
    reportDate: r.report_date,
    disease: names[r.disease_code] ?? r.disease_code,
    newCases: r.new_cases,
    suspectedCases: r.suspected_cases,
    notes: r.notes,
    status: r.status,
    flagged: r.flagged,
    createdAt: r.created_at,
    editPending: pending.has(r.id),
  }));
  return (
    <Card title={`${user.facility.name}: ${rows.length} report${rows.length === 1 ? '' : 's'}`}>
      <HistoryTable rows={rows} />
    </Card>
  );
}
