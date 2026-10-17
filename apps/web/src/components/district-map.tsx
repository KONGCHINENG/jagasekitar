'use client';
// View-only district risk map (MapLibre + OpenStreetMap raster tiles).
import {
  RISK_COLORS,
  RISK_ICONS,
  RISK_LABELS,
  RISK_LEVELS,
  riskRank,
  type RiskLevel,
} from '@jagasekitar/shared';
import type { MultiPolygon, Polygon } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface MapDistrict {
  name: string;
  geometry: Polygon | MultiPolygon | null;
}
export interface MapZone {
  district: string | null;
  diseaseCode: string | null;
  level: RiskLevel;
  reason: string;
}
export interface MapSummary {
  district: string;
  diseaseCode: string;
  diseaseName: string;
  cases7d: number;
  ratio: number | null;
}

export function DistrictMap({
  districts,
  zones,
  summary,
  diseases,
}: {
  districts: MapDistrict[];
  zones: MapZone[];
  summary: MapSummary[];
  diseases: { code: string; name: string }[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [disease, setDisease] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const levelByDistrict = useMemo(() => {
    const out: Record<string, RiskLevel> = {};
    for (const z of zones) {
      if (!z.district || (disease && z.diseaseCode !== disease)) continue;
      const cur = out[z.district] ?? 'none';
      if (riskRank(z.level) > riskRank(cur)) out[z.district] = z.level;
    }
    return out;
  }, [zones, disease]);

  const data = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: districts
        .filter((d) => d.geometry)
        .map((d) => ({
          type: 'Feature' as const,
          properties: {
            name: d.name,
            color: RISK_COLORS[levelByDistrict[d.name] ?? 'none'],
            none: !levelByDistrict[d.name],
          },
          geometry: d.geometry!,
        })),
    }),
    [districts, levelByDistrict],
  );

  useEffect(() => {
    if (!container.current || map.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
            maxzoom: 19,
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [101.0, 4.65],
      zoom: 7.2,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('districts', { type: 'geojson', data });
      m.addLayer({
        id: 'district-fill',
        type: 'fill',
        source: 'districts',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['get', 'none'], 0.08, 0.45],
        },
      });
      m.addLayer({
        id: 'district-line',
        type: 'line',
        source: 'districts',
        paint: { 'line-color': '#9D174D', 'line-width': 1 },
      });
      m.on('click', 'district-fill', (e) =>
        setSelected(String(e.features?.[0]?.properties?.name ?? '')),
      );
      m.on('mouseenter', 'district-fill', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'district-fill', () => (m.getCanvas().style.cursor = ''));
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // Created once; data updates go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const src = map.current?.getSource('districts') as maplibregl.GeoJSONSource | undefined;
    src?.setData(data);
  }, [data]);

  const rows = selected
    ? summary.filter((s) => s.district === selected && (!disease || s.diseaseCode === disease))
    : [];
  const reasons = selected
    ? zones.filter((z) => z.district === selected && (!disease || z.diseaseCode === disease))
    : [];

  return (
    <div className="flex flex-col gap-3">
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        Disease
        <select
          value={disease}
          onChange={(e) => setDisease(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All diseases</option>
          {diseases.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div
          ref={container}
          className="h-[480px] overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
        />
        <aside className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1" aria-label="Legend">
            {RISK_LEVELS.map((l) => (
              <li key={l} className="flex items-center gap-2">
                <span
                  className="inline-block h-3.5 w-3.5 rounded-sm"
                  style={{ backgroundColor: RISK_COLORS[l], opacity: l === 'none' ? 0.3 : 0.8 }}
                />
                {RISK_ICONS[l]} {RISK_LABELS[l].en}
              </li>
            ))}
          </ul>
          {selected ? (
            <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="font-semibold">{selected}</p>
              <p className="mb-2">
                {RISK_ICONS[levelByDistrict[selected] ?? 'none']}{' '}
                {RISK_LABELS[levelByDistrict[selected] ?? 'none'].en}
              </p>
              {rows.length === 0 && (
                <p className="text-neutral-500">No reports in the last 7 days.</p>
              )}
              {rows.map((r) => (
                <p key={r.diseaseCode}>
                  {r.diseaseName}: {r.cases7d} in 7 days
                  {r.ratio != null ? ` (${Number(r.ratio).toFixed(1)}× usual)` : ''}
                </p>
              ))}
              {reasons.map((z, i) => (
                <p key={i} className="mt-2 text-neutral-600 dark:text-neutral-400">
                  {z.reason}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-neutral-500">Click a district for details.</p>
          )}
          <p className="text-xs text-neutral-500">
            Aggregated reports only. Predictions are estimates.
          </p>
        </aside>
      </div>
    </div>
  );
}
