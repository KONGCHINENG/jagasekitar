import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { SourceRow, type SourceInfo } from './source-row';

export const metadata = { title: 'Data sources · Admin' };

export default function SourcesPage() {
  return (
    <>
      <PageTitle sub="Enable or pause each adapter, change how often it runs, refresh it now, and inspect the last payload.">
        Data sources
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-96" />}>
        <SourcesBody />
      </Suspense>
    </>
  );
}

async function SourcesBody() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from('data_source_status')
    .select(
      'source, enabled, refresh_minutes, last_success_at, last_error_at, last_error, last_record_count, used_mock, last_payload, refresh_requested_at',
    )
    .order('source');
  return (
    <div className="flex flex-col gap-4">
      {(data ?? []).map((s) => (
        <Card key={s.source}>
          <SourceRow source={s as SourceInfo} />
        </Card>
      ))}
      <p className="text-xs text-neutral-500">
        Requests are picked up by the worker on its next tick (within a minute when `npm run
        worker:dev` is running).
      </p>
    </div>
  );
}
