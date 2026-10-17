import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { DemoControls, type DemoState } from './demo-controls';

export const metadata = { title: 'Demo mode · Admin' };

export default function DemoPage() {
  return (
    <>
      <PageTitle sub="Replay seeded scenarios instead of live data, so the pitch works whatever the weather.">
        Demo mode
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-64" />}>
        <DemoBody />
      </Suspense>
    </>
  );
}

async function DemoBody() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from('settings').select('value').eq('key', 'demo_mode').single();
  return (
    <Card>
      <DemoControls state={(data?.value ?? {}) as DemoState} />
    </Card>
  );
}
