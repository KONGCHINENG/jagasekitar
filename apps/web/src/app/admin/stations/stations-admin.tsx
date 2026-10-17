'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { PortalMap } from '@/components/portal-map';
import { Card } from '@/components/ui';
import { moveStation, setStationActive } from '../actions';

export interface StationInfo {
  kind: 'rain' | 'water_level';
  station_id: string;
  name: string;
  river: string | null;
  district: string | null;
  active: boolean;
  coords_source: string;
  lat: number | null;
  lon: number | null;
}

// Precision of the location, worst to best, so admins know what to fix first.
const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  seed: { text: 'Seed placeholder', cls: 'text-neutral-500' },
  district: { text: 'District centre (rough)', cls: 'text-red-700 dark:text-red-400' },
  jps_grid: { text: 'JPS grid (~5 km)', cls: 'text-amber-700 dark:text-amber-400' },
  nominatim: { text: 'Geocoded', cls: 'text-cyan-800 dark:text-cyan-300' },
  jps: { text: 'JPS alert feed (exact)', cls: 'text-green-700 dark:text-green-400' },
  admin: { text: 'Set by admin', cls: 'text-green-700 dark:text-green-400' },
};

const key = (s: StationInfo) => `${s.kind}:${s.station_id}`;

export function StationsAdmin({ stations }: { stations: StationInfo[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<'all' | 'rain' | 'water_level'>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const shown = useMemo(
    () => stations.filter((s) => (kind === 'all' || s.kind === kind) && (showInactive || s.active)),
    [stations, kind, showInactive],
  );

  const pins = useMemo(
    () =>
      shown
        .filter((s) => s.lat != null && s.lon != null)
        .map((s) => ({
          id: key(s),
          lat: s.lat!,
          lon: s.lon!,
          color: s.kind === 'rain' ? '#0891B2' : '#1D4ED8',
          label: `${s.kind === 'rain' ? '☔' : '🌊'} ${s.name} (${s.station_id}) · ${SOURCE_LABEL[s.coords_source]?.text ?? s.coords_source}`,
          draggable: s.active,
        })),
    [shown],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {(['all', 'rain', 'water_level'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-md px-3 py-1 ${kind === k ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}
          >
            {k === 'all' ? 'All' : k === 'rain' ? '☔ Rain' : '🌊 Water level'}
          </button>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />{' '}
          Show inactive
        </label>
        {msg && <span role="status">{msg}</span>}
      </div>
      <PortalMap
        pins={pins}
        onPinMoved={async (id, lat, lon) => {
          const [k, ...rest] = id.split(':');
          const res = await moveStation(k!, rest.join(':'), lat, lon);
          setMsg(res.ok ? `✓ ${res.message}` : `✕ ${res.message}`);
          if (res.ok) router.refresh();
        }}
      />
      <Card title={`${shown.length} stations`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-neutral-600 dark:text-neutral-400">
              <tr>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">ID</th>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">District</th>
                <th className="pb-2 font-medium">Location</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr
                  key={key(s)}
                  className={`border-t border-neutral-100 dark:border-neutral-900 ${s.active ? '' : 'opacity-50'}`}
                >
                  <td className="py-1.5">{s.kind === 'rain' ? '☔' : '🌊'}</td>
                  <td className="py-1.5 font-mono text-xs">{s.station_id}</td>
                  <td className="py-1.5">
                    {s.name}
                    {s.river && <span className="text-neutral-500"> · {s.river}</span>}
                  </td>
                  <td className="py-1.5">{s.district}</td>
                  <td className={`py-1.5 ${SOURCE_LABEL[s.coords_source]?.cls ?? ''}`}>
                    {SOURCE_LABEL[s.coords_source]?.text ?? s.coords_source}
                  </td>
                  <td className="py-1.5 text-right">
                    <ActionButton action={() => setStationActive(s.kind, s.station_id, !s.active)}>
                      {s.active ? 'Deactivate' : 'Activate'}
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
