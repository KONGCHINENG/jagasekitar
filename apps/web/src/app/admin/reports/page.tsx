import { Suspense } from 'react';
import { ActionButton } from '@/components/action-button';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { reviewEdit, reviewReport } from '../actions';

export const metadata = { title: 'Case reports · Admin' };

const approve =
  'rounded-md bg-green-700 px-2.5 py-1 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50';
const reject =
  'rounded-md border border-red-300 px-2.5 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400';

export default function ReportsPage() {
  return (
    <>
      <PageTitle sub="Verify flagged spikes and review change requests made after the 48-hour edit window. Every decision is in the audit log.">
        Case reports
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[500px]" />}>
        <ReportsBody />
      </Suspense>
    </>
  );
}

async function ReportsBody() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: flagged }, { data: edits }, { data: recent }] = await Promise.all([
    supabase
      .from('case_reports')
      .select(
        'id, report_date, disease_code, new_cases, suspected_cases, notes, created_at, facilities(name, district)',
      )
      .eq('flagged', true)
      .eq('status', 'submitted')
      .order('report_date', { ascending: false }),
    supabase
      .from('case_report_edits')
      .select(
        'id, new_cases, suspected_cases, notes, reason, created_at, case_reports(report_date, disease_code, new_cases, suspected_cases, facilities(name))',
      )
      .eq('status', 'pending')
      .order('created_at'),
    supabase
      .from('case_reports')
      .select(
        'id, report_date, disease_code, new_cases, suspected_cases, status, flagged, facilities(name)',
      )
      .order('created_at', { ascending: false })
      .limit(30),
  ]);
  type Fac = { name: string; district?: string } | null;

  return (
    <div className="flex flex-col gap-6">
      <Card title={`Flagged as unusual spikes (${flagged?.length ?? 0})`}>
        {!flagged?.length && <p className="text-sm text-neutral-500">Nothing to review.</p>}
        <ul className="flex flex-col gap-2">
          {flagged?.map((r) => {
            const f = r.facilities as unknown as Fac;
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50/50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30"
              >
                <span className="flex-1">
                  ▲ <strong>{r.disease_code}</strong> · {r.new_cases} confirmed, {r.suspected_cases}{' '}
                  suspected on {r.report_date} at {f?.name} ({f?.district})
                  {r.notes && <span className="text-neutral-600"> · “{r.notes}”</span>}
                </span>
                <ActionButton
                  className={approve}
                  action={reviewReport.bind(null, r.id, 'verified')}
                >
                  Verify
                </ActionButton>
                <ActionButton
                  className={reject}
                  action={reviewReport.bind(null, r.id, 'rejected')}
                  confirm="Reject this report? It will be excluded from the illness map."
                >
                  Reject
                </ActionButton>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={`Change requests after 48 h (${edits?.length ?? 0})`}>
        {!edits?.length && <p className="text-sm text-neutral-500">Nothing to review.</p>}
        <ul className="flex flex-col gap-2">
          {edits?.map((e) => {
            const r = e.case_reports as unknown as {
              report_date: string;
              disease_code: string;
              new_cases: number;
              suspected_cases: number;
              facilities: Fac;
            } | null;
            return (
              <li
                key={e.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <span className="flex-1">
                  <strong>{r?.disease_code}</strong> {r?.report_date} at {r?.facilities?.name}:
                  confirmed {r?.new_cases} → <strong>{e.new_cases}</strong>, suspected{' '}
                  {r?.suspected_cases} → <strong>{e.suspected_cases}</strong>
                  <span className="block text-neutral-600 dark:text-neutral-400">
                    Reason: {e.reason}
                  </span>
                </span>
                <ActionButton className={approve} action={reviewEdit.bind(null, e.id, true)}>
                  Apply
                </ActionButton>
                <ActionButton className={reject} action={reviewEdit.bind(null, e.id, false)}>
                  Reject
                </ActionButton>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Latest submissions">
        <table className="w-full text-sm">
          <tbody>
            {recent?.map((r) => (
              <tr
                key={r.id}
                className="border-t border-neutral-100 first:border-0 dark:border-neutral-900"
              >
                <td className="py-1.5">{r.report_date}</td>
                <td className="py-1.5">{(r.facilities as unknown as Fac)?.name}</td>
                <td className="py-1.5">{r.disease_code}</td>
                <td className="py-1.5 text-right tabular-nums">{r.new_cases}</td>
                <td className="py-1.5 text-right tabular-nums text-neutral-500">
                  {r.suspected_cases}
                </td>
                <td className="py-1.5">
                  {r.status}
                  {r.flagged && r.status === 'submitted' ? ' · ▲ flagged' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
