import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireReportingStaff } from '@/lib/auth';
import { todayMyt } from '@/lib/reports';
import { createClient } from '@/lib/supabase/server';
import { requestTime } from '@/lib/time';
import { ReportGrid } from './report-grid';

export const metadata = { title: 'Report cases · Hospital portal' };

export default function ReportPage() {
  return (
    <>
      <PageTitle sub="One row per disease. Re-submitting the same disease and date within 48 hours updates it.">
        Report cases
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-64" />}>
        <ReportBody />
      </Suspense>
    </>
  );
}

async function ReportBody() {
  const user = await requireReportingStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from('disease_types')
    .select('code, name_en')
    .eq('active', true)
    .order('name_en');
  return (
    <Card title={user.facility.name}>
      <ReportGrid
        diseases={(data ?? []).map((d) => ({ code: d.code, name: d.name_en }))}
        today={todayMyt(await requestTime())}
      />
    </Card>
  );
}
