import { Suspense } from 'react';
import { Card, PageTitle, Skeleton, secondaryButtonClass } from '@/components/ui';
import { requireReportingStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { CsvUpload } from './csv-upload';

export const metadata = { title: 'CSV upload · Hospital portal' };

export default function UploadPage() {
  return (
    <>
      <PageTitle sub="Bulk entry: one row per disease per day. Columns: report_date, disease_code, new_cases, suspected_cases, notes.">
        CSV upload
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-48" />}>
        <UploadBody />
      </Suspense>
    </>
  );
}

async function UploadBody() {
  const user = await requireReportingStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from('disease_types')
    .select('code, name_en')
    .eq('active', true)
    .order('name_en');
  const diseases = (data ?? []).map((d) => ({ code: d.code, name: d.name_en }));
  return (
    <>
      <Card title="1. Download the template">
        <a
          href="/hospital/template.csv"
          download
          className={`${secondaryButtonClass} inline-block`}
        >
          ⬇ jagasekitar-cases-template.csv
        </a>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          Disease codes: {diseases.map((d) => `${d.code} (${d.name})`).join(', ')}.
        </p>
      </Card>
      <Card title={`2. Upload for ${user.facility.name}`}>
        <CsvUpload diseases={diseases} />
      </Card>
    </>
  );
}
