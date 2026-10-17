'use client';
import {
  HAZARD_PALETTES,
  RISK_LEVELS,
  riskRank,
  type Hazard,
  type RiskLevel,
} from '@jagasekitar/shared';
import type { MultiPolygon, Polygon } from 'geojson';
import { useMemo, useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { PortalMap } from '@/components/portal-map';
import { requestPredictionRun } from '../actions';

interface Zone {
  id: string;
  hazard: Hazard;
  level: RiskLevel;
  geometry: Polygon | MultiPolygon;
}

export function ZonePreview({ zones }: { zones: Zone[] }) {
  const [hazard, setHazard] = useState<Hazard>('flood');
  const areas = useMemo(
    () =>
      zones
        .filter((z) => z.hazard === hazard)
        .sort((a, b) => riskRank(a.level) - riskRank(b.level))
        .map((z) => ({
          id: z.id,
          geometry: z.geometry,
          color: HAZARD_PALETTES[hazard].scale[riskRank(z.level)]!,
          opacity: 0.55,
          outline: HAZARD_PALETTES[hazard].base,
        })),
    [zones, hazard],
  );
  const count = (l: RiskLevel) => zones.filter((z) => z.hazard === hazard && z.level === l).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 text-sm" role="tablist">
        {(['haze', 'flood', 'disease'] as const).map((h) => (
          <button
            key={h}
            role="tab"
            aria-selected={hazard === h}
            onClick={() => setHazard(h)}
            className={`rounded-md px-3 py-1 ${hazard === h ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}
          >
            {HAZARD_PALETTES[h].icon} {h}
          </button>
        ))}
      </div>
      <PortalMap areas={areas} height="h-[380px]" zoom={6.4} center={[101.2, 4.2]} />
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        {RISK_LEVELS.filter((l) => l !== 'none')
          .map((l) => `${l}: ${count(l)}`)
          .join(' · ')}
      </p>
      <ActionButton
        action={requestPredictionRun}
        className="rounded-lg border border-cyan-800 px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-50 dark:border-cyan-400 dark:text-cyan-300"
      >
        ↻ Re-run predictions
      </ActionButton>
    </div>
  );
}
