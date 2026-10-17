import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { BroadcastForm } from './broadcast-form';

export const metadata = { title: 'Broadcast alert · Admin' };

export default function BroadcastPage() {
  return (
    <>
      <PageTitle sub="Send an alert to every phone whose last known location is in the chosen districts. Push where available, in-app otherwise.">
        Broadcast alert
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[600px]" />}>
        <BroadcastBody />
      </Suspense>
    </>
  );
}

async function BroadcastBody() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: districts }, { data: history }] = await Promise.all([
    supabase.from('v_districts_geojson').select('name, geometry').eq('state', 'PRK').order('name'),
    supabase
      .from('admin_broadcasts')
      .select('id, title_en, level, target_districts, recipient_count, sent_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);
  return (
    <>
      <BroadcastForm districts={districts ?? []} />
      <Card title="Recent broadcasts">
        {!history?.length && <p className="text-sm text-neutral-500">None yet.</p>}
        <ul className="text-sm">
          {history?.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap gap-3 border-t border-neutral-100 py-1.5 first:border-0 dark:border-neutral-900"
            >
              <span className="font-medium">{b.title_en}</span>
              <span className="text-neutral-500">{b.level}</span>
              <span className="text-neutral-500">{(b.target_districts ?? []).join(', ')}</span>
              <span className="ml-auto text-neutral-500">
                {b.sent_at
                  ? `${b.recipient_count ?? 0} devices · ${new Date(b.sent_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`
                  : 'not sent'}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
