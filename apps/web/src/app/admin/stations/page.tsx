import { Suspense } from 'react';
import { PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { StationsAdmin, type StationInfo } from './stations-admin';

export const metadata = { title: 'Stations · Admin' };

export default function StationsPage() {
  return (
    <>
      <PageTitle sub="JPS publishes no coordinates. Drag a pin to correct a station; admin-set locations are never overwritten by the worker.">
        Stations
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[600px]" />}>
        <StationsBody />
      </Suspense>
    </>
  );
}

async function StationsBody() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from('v_stations_admin')
    .select('kind, station_id, name, river, district, active, coords_source, lat, lon')
    .eq('state', 'PRK')
    .order('district')
    .order('name');
  return <StationsAdmin stations={(data ?? []) as StationInfo[]} />;
}
