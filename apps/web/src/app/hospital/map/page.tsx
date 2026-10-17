import { Suspense } from 'react';
import { DistrictMap } from '@/components/district-map';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'District map · Hospital portal' };

export default function MapPage() {
  return (
    <>
      <PageTitle sub="Current illness risk by district, from all facilities' aggregated reports and flood/haze linkage.">
        District map
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[480px]" />}>
        <MapBody />
      </Suspense>
    </>
  );
}

async function MapBody() {
  const user = await requireUser();
  const state = user.facility?.state ?? 'PRK';
  const supabase = await createClient();
  const [{ data: districts }, { data: zones }, { data: summary }, { data: types }] =
    await Promise.all([
      supabase.from('v_districts_geojson').select('name, geometry').eq('state', state),
      supabase
        .from('v_active_zones')
        .select('district, disease_code, level, reason_en')
        .eq('hazard', 'disease'),
      supabase
        .from('v_disease_district_summary')
        .select('district, disease_code, disease_name_en, cases_7d, baseline_ratio')
        .eq('state', state),
      supabase.from('disease_types').select('code, name_en').eq('active', true).order('name_en'),
    ]);
  return (
    <Card>
      <DistrictMap
        districts={districts ?? []}
        zones={(zones ?? []).map((z) => ({
          district: z.district,
          diseaseCode: z.disease_code,
          level: z.level,
          reason: z.reason_en,
        }))}
        summary={(summary ?? []).map((s) => ({
          district: s.district,
          diseaseCode: s.disease_code,
          diseaseName: s.disease_name_en,
          cases7d: s.cases_7d,
          ratio: s.baseline_ratio,
        }))}
        diseases={(types ?? []).map((t) => ({ code: t.code, name: t.name_en }))}
      />
    </Card>
  );
}
