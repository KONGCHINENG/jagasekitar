import Link from 'next/link';
import { Suspense } from 'react';
import { DailyBars, type DayCount } from '@/components/daily-bars';
import { Card, PageTitle, Skeleton, buttonClass } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { todayMyt } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';
import { requestTime } from '@/lib/time';
import { JoinRequestForm } from './join-request-form';

export const metadata = { title: 'Dashboard · Hospital portal' };

export default function HospitalDashboard() {
  return (
    <>
      <PageTitle sub="Daily aggregate case reporting for the JagaSekitar illness map.">
        Dashboard
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-72" />}>
        <DashboardBody />
      </Suspense>
    </>
  );
}

async function DashboardBody() {
  const user = await requireUser();
  const supabase = await createClient();

  if (user.role === 'admin' && !user.facility) {
    return (
      <Card>
        You are an administrator. Manage facilities and reports in the{' '}
        <Link href="/admin" className="text-cyan-800 underline dark:text-cyan-300">
          admin panel
        </Link>
        .
      </Card>
    );
  }

  if (!user.facility?.verified || user.role !== 'hospital_staff') {
    if (user.pendingRequest) {
      return (
        <Card title="Access request pending">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            An administrator is reviewing your request to report for a facility. You will be able to
            submit cases once it is approved.
          </p>
        </Card>
      );
    }
    const { data: facilities } = await supabase
      .from('facilities')
      .select('id, name, district, type')
      .eq('verified', true)
      .order('district')
      .order('name');
    const { data: districts } = await supabase
      .from('districts')
      .select('name')
      .eq('state', 'PRK')
      .order('name');
    return (
      <Card title="Request access to your facility">
        <JoinRequestForm
          facilities={facilities ?? []}
          districts={(districts ?? []).map((d) => d.name)}
        />
      </Card>
    );
  }

  const today = todayMyt(await requestTime());
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 13 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data: reports } = await supabase
    .from('case_reports')
    .select('report_date, new_cases, suspected_cases, flagged, status')
    .eq('facility_id', user.facility.id)
    .gte('report_date', from)
    .neq('status', 'rejected');

  const days: DayCount[] = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = (reports ?? []).filter((r) => r.report_date === date);
    return {
      date,
      confirmed: rows.reduce((a, r) => a + r.new_cases, 0),
      suspected: rows.reduce((a, r) => a + r.suspected_cases, 0),
    };
  });
  const todayRows = (reports ?? []).filter((r) => r.report_date === today);
  const flagged = (reports ?? []).filter((r) => r.flagged && r.status === 'submitted').length;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card title="Your facility">
        <p className="font-medium">{user.facility.name}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {user.facility.district}, {user.facility.state === 'PRK' ? 'Perak' : user.facility.state}
        </p>
      </Card>
      <Card title="Today">
        {todayRows.length > 0 ? (
          <p className="text-sm">
            <span className="font-semibold text-green-700 dark:text-green-400">✓ Submitted</span> ·{' '}
            {todayRows.length} disease
            {todayRows.length === 1 ? '' : 's'} reported
          </p>
        ) : (
          <p className="text-sm">
            <span className="font-semibold text-amber-700 dark:text-amber-400">
              ▲ Not submitted yet
            </span>
          </p>
        )}
        <Link href="/hospital/report" className={`${buttonClass} mt-3 inline-block`}>
          Report today’s cases
        </Link>
      </Card>
      <Card title="Awaiting review">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {flagged === 0
            ? 'No flagged reports.'
            : `${flagged} report${flagged === 1 ? '' : 's'} flagged as unusual spikes, waiting for an admin.`}
        </p>
      </Card>
      <Card title="Confirmed cases reported, last 14 days" className="md:col-span-3">
        <DailyBars days={days} />
      </Card>
    </div>
  );
}
