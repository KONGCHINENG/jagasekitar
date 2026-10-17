import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { requestTime } from '@/lib/time';
import { SettingForm } from './setting-form';
import { ZonePreview } from './zone-preview';

export const metadata = { title: 'Thresholds · Admin' };

const ORDER = ['haze', 'flood', 'disease', 'notifications', 'refresh_minutes', 'retention_hours'];

export default function ThresholdsPage() {
  return (
    <>
      <PageTitle sub="Every engine threshold lives here. Save, then re-run predictions to see the effect on the preview map.">
        Thresholds &amp; model settings
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[600px]" />}>
        <ThresholdsBody />
      </Suspense>
    </>
  );
}

async function ThresholdsBody() {
  await requireAdmin();
  const supabase = await createClient();
  const nowIso = (await requestTime()).toISOString();
  const [{ data: settings }, { data: zones }] = await Promise.all([
    supabase.from('settings').select('key, value, description').in('key', ORDER),
    supabase
      .from('v_active_zones')
      .select('id, hazard, level, geometry, valid_from')
      .lte('valid_from', nowIso),
  ]);
  const sorted = [...(settings ?? [])].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-6">
        {sorted.map((s) => (
          <Card key={s.key} title={`${s.key} · ${s.description ?? ''}`}>
            <SettingForm settingKey={s.key} value={s.value} />
          </Card>
        ))}
      </div>
      <div className="xl:sticky xl:top-6 xl:self-start">
        <Card title="Preview: zones active now">
          <ZonePreview zones={zones ?? []} />
        </Card>
      </div>
    </div>
  );
}
