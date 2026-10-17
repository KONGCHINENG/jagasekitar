// Risk along a route: sample the line every ~1 km, assess each sample, colour contiguous runs,
// and summarise "Along your route: flood risk near Bota (moderate)".
import type { Hazard, HazardZone, RiskLevel } from '@jagasekitar/shared';
import { riskRank } from '@jagasekitar/shared';
import { assessPoint } from './assess';
import { destinationPoint, haversineKm } from './geo';
import type { Place } from './types';

export type LonLat = [number, number];

/** Points every `stepKm` along a [lon, lat] polyline (always includes both ends). */
export function sampleLine(coords: LonLat[], stepKm = 1): LonLat[] {
  if (coords.length < 2) return [...coords];
  const out: LonLat[] = [coords[0]!];
  let carry = 0; // distance since the last sample
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1]!;
    const [lon2, lat2] = coords[i]!;
    const seg = haversineKm(lat1, lon1, lat2, lon2);
    if (seg === 0) continue;
    const bearing =
      (Math.atan2(
        Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180),
        Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
          Math.sin((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.cos(((lon2 - lon1) * Math.PI) / 180),
      ) *
        180) /
      Math.PI;
    let d = stepKm - carry;
    while (d <= seg) {
      const [lat, lon] = destinationPoint(lat1, lon1, bearing, d);
      out.push([lon, lat]);
      d += stepKm;
    }
    carry = seg - (d - stepKm);
  }
  const last = coords.at(-1)!;
  const prev = out.at(-1)!;
  if (prev[0] !== last[0] || prev[1] !== last[1]) out.push(last);
  return out;
}

export interface RouteSegment {
  level: RiskLevel;
  hazard: Hazard | null;
  coords: LonLat[];
}

export interface RouteHit {
  hazard: Hazard;
  level: RiskLevel;
  /** Nearest named place to where the route meets the risk. */
  near: string;
  lat: number;
  lon: number;
}

export interface RouteRisk {
  segments: RouteSegment[];
  hits: RouteHit[];
  worst: RiskLevel;
}

function nearestPlace(lat: number, lon: number, places: Place[]): string | null {
  let best: Place | null = null;
  let bestKm = Infinity;
  for (const p of places) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestKm) {
      bestKm = d;
      best = p;
    }
  }
  return best?.name ?? null;
}

export function riskAlongRoute(
  coords: LonLat[],
  zones: HazardZone[],
  opts: { time?: Date; places?: Place[]; stepKm?: number } = {},
): RouteRisk {
  const samples = sampleLine(coords, opts.stepKm ?? 1);
  const assessed = samples.map(([lon, lat]) => {
    const a = assessPoint(lat, lon, zones, { time: opts.time });
    const top = a.zones[0];
    return { lon, lat, level: a.overall, hazard: top ? top.hazard : null, zones: a.zones };
  });

  // Contiguous runs of the same level become one coloured segment (sharing boundary points).
  const segments: RouteSegment[] = [];
  for (const s of assessed) {
    const cur = segments.at(-1);
    if (cur && cur.level === s.level) {
      cur.coords.push([s.lon, s.lat]);
    } else {
      if (cur) cur.coords.push([s.lon, s.lat]);
      segments.push({ level: s.level, hazard: s.hazard, coords: [[s.lon, s.lat]] });
    }
  }

  // One hit per hazard × place, keeping the worst level seen there.
  const hits = new Map<string, RouteHit>();
  for (const s of assessed) {
    for (const z of s.zones) {
      const near =
        z.id.split(':')[1] && z.hazard !== 'haze'
          ? z.id.split(':')[1]!
          : (nearestPlace(s.lat, s.lon, opts.places ?? []) ?? '');
      const key = `${z.hazard}|${near}`;
      const cur = hits.get(key);
      if (!cur || riskRank(z.level) > riskRank(cur.level)) {
        hits.set(key, { hazard: z.hazard, level: z.level, near, lat: s.lat, lon: s.lon });
      }
    }
  }
  const sortedHits = [...hits.values()].sort((a, b) => riskRank(b.level) - riskRank(a.level));
  const worst = assessed.reduce<RiskLevel>(
    (w, s) => (riskRank(s.level) > riskRank(w) ? s.level : w),
    'none',
  );
  return { segments, hits: sortedHits, worst };
}

/** Total length of a [lon, lat] polyline in km. */
export function lineLengthKm(coords: LonLat[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    km += haversineKm(coords[i - 1]![1], coords[i - 1]![0], coords[i]![1], coords[i]![0]);
  }
  return km;
}
