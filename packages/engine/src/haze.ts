// Haze engine: a deliberately simple smoke-transport model.
//
// Assumptions (keep these in mind when reading the output):
//  1. Fires keep burning at their detected intensity. Each cluster of hotspots emits smoke
//     continuously from 48 h before "now" to the end of the forecast. Emission is discretised into
//     puffs released every RELEASE_STEP_H hours, with mass ∝ the cluster's total FRP.
//  2. Each puff is advected by the wind at its current position and time: a vector blend of
//     850 hPa (long-range transport) and 10 m winds, stepped hourly (Euler). Before the first
//     forecast hour, the earliest wind is used.
//  3. A puff spreads as a 2-D Gaussian whose half-width grows linearly with age (spreadKmh, capped)
//     and whose mass decays exponentially (decayHours) for dilution, deposition and rain-out.
//  4. Puff concentrations are summed on a ~5 km grid and contoured into risk bands with
//     admin-configurable thresholds. Scores are unitless; SCORE_SCALE was set so the defaults
//     give "low" for typical cross-Strait haze and "severe" for major fire seasons.
//  5. Open-Meteo's PM2.5 forecast cross-checks each zone: it only adjusts confidence, never the
//     zone itself.
// It ignores terrain, vertical mixing, plume rise and chemistry, so treat output as indicative.
import isobands from '@turf/isobands';
import { featureCollection, point } from '@turf/helpers';
import type { MultiPolygon } from 'geojson';
import { RISK_LEVELS, type HazardZone, type RiskLevel } from '@jagasekitar/shared';
import { DEFAULT_HAZE, type HazeConfig } from './config';
import { destinationPoint, haversineKm, windToBearing } from './geo';
import { areaBbox, circleArea, pointInArea, toMulti } from './geom';
import { compass, compassMs, regionName, regionNameMs } from './regions';
import type { AirQualityObsInput, Hotspot, Place, Pm25Sample, WindSample } from './types';

const HOUR = 3600_000;
const RELEASE_STEP_H = 6;
const PAST_EMISSION_H = 48;
const SCORE_SCALE = 20;
/** Puffs whose peak can't reach this fraction of the "low" threshold are skipped (speed). */
const NEGLIGIBLE = 0.02;
const CONFIDENCE_RANK = { l: 0, n: 1, h: 2 } as const;
const DEFAULT_FRP_MW = 5;

// ---------------------------------------------------------------------------
// 1. Clustering (DBSCAN with minPts = 1, i.e. connected components within the radius)
// ---------------------------------------------------------------------------
export interface FireCluster {
  lat: number;
  lon: number;
  count: number;
  frpSum: number;
  region: string;
}

export function clusterHotspots(
  hotspots: Hotspot[],
  radiusKm: number,
  minConfidence: Hotspot['confidence'] = 'n',
): FireCluster[] {
  const pts = hotspots.filter(
    (h) => CONFIDENCE_RANK[h.confidence] >= CONFIDENCE_RANK[minConfidence],
  );
  // Spatial hash with cells one radius wide, so neighbours are within the 3×3 block.
  const cellDeg = radiusKm / 111.32;
  const key = (lat: number, lon: number) =>
    `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`;
  const buckets = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = key(p.lat, p.lon);
    buckets.set(k, [...(buckets.get(k) ?? []), i]);
  });

  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  pts.forEach((p, i) => {
    const cy = Math.floor(p.lat / cellDeg);
    const cx = Math.floor(p.lon / cellDeg);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of buckets.get(`${cy + dy}:${cx + dx}`) ?? []) {
          if (j > i && haversineKm(p.lat, p.lon, pts[j]!.lat, pts[j]!.lon) <= radiusKm) {
            parent[find(j)] = find(i);
          }
        }
      }
    }
  });

  const groups = new Map<number, Hotspot[]>();
  pts.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p]));
  return [...groups.values()]
    .map((members) => {
      const frps = members.map((m) => m.frp ?? DEFAULT_FRP_MW);
      const frpSum = frps.reduce((a, b) => a + b, 0);
      // FRP-weighted centre: the hottest fires dominate the plume source.
      const lat = members.reduce((a, m, i) => a + m.lat * frps[i]!, 0) / frpSum;
      const lon = members.reduce((a, m, i) => a + m.lon * frps[i]!, 0) / frpSum;
      return { lat, lon, count: members.length, frpSum, region: regionName(lat, lon) };
    })
    .sort((a, b) => b.frpSum - a.frpSum);
}

// ---------------------------------------------------------------------------
// 2. Wind field
// ---------------------------------------------------------------------------
export interface WindVector {
  /** Eastward and northward components of the direction the air moves TOWARDS, km/h. */
  u: number;
  v: number;
}

/** Meteorological (speed, direction FROM) → travel vector. */
export function windVector(speedKmh: number, fromDeg: number): WindVector {
  const b = (windToBearing(fromDeg) * Math.PI) / 180;
  return { u: speedKmh * Math.sin(b), v: speedKmh * Math.cos(b) };
}

export function vectorToBearing({ u, v }: WindVector): { speed: number; bearing: number } {
  return { speed: Math.hypot(u, v), bearing: ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360 };
}

export class WindField {
  private readonly times: number[];
  private readonly byTime = new Map<number, { lat: number; lon: number; w: WindVector }[]>();

  constructor(samples: WindSample[], blend850 = DEFAULT_HAZE.windBlend850) {
    for (const s of samples) {
      const surface =
        s.windSpeed10m != null && s.windDir10m != null
          ? windVector(s.windSpeed10m, s.windDir10m)
          : null;
      const aloft =
        s.windSpeed850 != null && s.windDir850 != null
          ? windVector(s.windSpeed850, s.windDir850)
          : null;
      const w =
        surface && aloft
          ? {
              u: aloft.u * blend850 + surface.u * (1 - blend850),
              v: aloft.v * blend850 + surface.v * (1 - blend850),
            }
          : (aloft ?? surface);
      if (!w) continue;
      const t = Date.parse(s.validAt);
      const list = this.byTime.get(t) ?? [];
      list.push({ lat: s.lat, lon: s.lon, w });
      this.byTime.set(t, list);
    }
    this.times = [...this.byTime.keys()].sort((a, b) => a - b);
    if (this.times.length === 0) throw new Error('No wind data: run the open_meteo source first');
  }

  /** Inverse-distance-weighted wind from the 4 nearest grid points at the nearest forecast hour. */
  at(lat: number, lon: number, timeMs: number): WindVector {
    let best = this.times[0]!;
    for (const t of this.times) if (Math.abs(t - timeMs) < Math.abs(best - timeMs)) best = t;
    const grid = this.byTime.get(best)!;
    // Top-4 by squared equirectangular distance (cheap, and plenty accurate at grid scale).
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const nearest: { g: (typeof grid)[number]; d2: number }[] = [];
    for (const g of grid) {
      const dx = (g.lon - lon) * cosLat;
      const dy = g.lat - lat;
      const d2 = dx * dx + dy * dy;
      if (nearest.length < 4 || d2 < nearest[3]!.d2) {
        nearest.push({ g, d2 });
        nearest.sort((a, b) => a.d2 - b.d2);
        if (nearest.length > 4) nearest.pop();
      }
    }
    if (nearest[0]!.d2 < 1e-8) return nearest[0]!.g.w;
    let u = 0;
    let v = 0;
    let sum = 0;
    for (const { g, d2 } of nearest) {
      const k = 1 / d2;
      u += g.w.u * k;
      v += g.w.v * k;
      sum += k;
    }
    return { u: u / sum, v: v / sum };
  }
}

// ---------------------------------------------------------------------------
// 3. Trajectories
// ---------------------------------------------------------------------------
export interface TrajectoryPoint {
  lat: number;
  lon: number;
  ageH: number;
}

/** Forward trajectory from (lat, lon) released at `startMs`, one point per hour of age. */
export function trajectory(
  wind: WindField,
  lat: number,
  lon: number,
  startMs: number,
  hours: number,
): TrajectoryPoint[] {
  const pts: TrajectoryPoint[] = [{ lat, lon, ageH: 0 }];
  let cur = { lat, lon };
  for (let h = 1; h <= hours; h++) {
    const w = wind.at(cur.lat, cur.lon, startMs + (h - 1) * HOUR);
    const { speed, bearing } = vectorToBearing(w);
    const [nlat, nlon] = destinationPoint(cur.lat, cur.lon, bearing, speed); // 1 h step
    cur = { lat: nlat, lon: nlon };
    pts.push({ ...cur, ageH: h });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// 4. Raster
// ---------------------------------------------------------------------------
export interface Raster {
  west: number;
  south: number;
  dLat: number;
  dLon: number;
  nx: number;
  ny: number;
  values: Float64Array;
}

export function makeRaster(domain: HazeConfig['domain'], gridKm: number): Raster {
  const [w, s, e, n] = domain;
  const dLat = gridKm / 111.32;
  const dLon = gridKm / (111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  const nx = Math.ceil((e - w) / dLon) + 1;
  const ny = Math.ceil((n - s) / dLat) + 1;
  return { west: w, south: s, dLat, dLon, nx, ny, values: new Float64Array(nx * ny) };
}

export function halfWidthKm(
  ageH: number,
  cfg: Pick<HazeConfig, 'spreadKmh' | 'maxHalfWidthKm'>,
): number {
  return Math.min(2 + cfg.spreadKmh * ageH, cfg.maxHalfWidthKm);
}

/** Add one Gaussian puff (mass in MW·h) to the raster. Returns false if negligible and skipped. */
export function addPuff(
  r: Raster,
  lat: number,
  lon: number,
  mass: number,
  ageH: number,
  cfg: HazeConfig,
): boolean {
  const sigma = halfWidthKm(ageH, cfg);
  const peak =
    (SCORE_SCALE * mass * Math.exp(-ageH / cfg.decayHours)) / (2 * Math.PI * sigma * sigma);
  if (peak < cfg.scoreThresholds.low * NEGLIGIBLE) return false;
  const reachKm = 3 * sigma;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const iy0 = Math.max(0, Math.floor((lat - reachKm / 111.32 - r.south) / r.dLat));
  const iy1 = Math.min(r.ny - 1, Math.ceil((lat + reachKm / 111.32 - r.south) / r.dLat));
  const ix0 = Math.max(0, Math.floor((lon - reachKm / (111.32 * cosLat) - r.west) / r.dLon));
  const ix1 = Math.min(r.nx - 1, Math.ceil((lon + reachKm / (111.32 * cosLat) - r.west) / r.dLon));
  if (iy0 > iy1 || ix0 > ix1) return false;
  for (let iy = iy0; iy <= iy1; iy++) {
    const cy = r.south + iy * r.dLat;
    const dy = (cy - lat) * 111.32;
    for (let ix = ix0; ix <= ix1; ix++) {
      const dx = (r.west + ix * r.dLon - lon) * 111.32 * cosLat;
      const d2 = dx * dx + dy * dy;
      if (d2 > reachKm * reachKm) continue;
      r.values[iy * r.nx + ix]! += peak * Math.exp(-d2 / (2 * sigma * sigma));
    }
  }
  return true;
}

export function rasterAt(r: Raster, lat: number, lon: number): number {
  const ix = Math.round((lon - r.west) / r.dLon);
  const iy = Math.round((lat - r.south) / r.dLat);
  if (ix < 0 || iy < 0 || ix >= r.nx || iy >= r.ny) return 0;
  return r.values[iy * r.nx + ix]!;
}

/** Contour the raster into one MultiPolygon per risk band (low…severe). */
export function rasterBands(
  r: Raster,
  thresholds: HazeConfig['scoreThresholds'],
): Map<RiskLevel, MultiPolygon> {
  const pts = [];
  for (let iy = 0; iy < r.ny; iy++) {
    for (let ix = 0; ix < r.nx; ix++) {
      pts.push(
        point([r.west + ix * r.dLon, r.south + iy * r.dLat], { z: r.values[iy * r.nx + ix]! }),
      );
    }
  }
  const levels = RISK_LEVELS.filter((l): l is Exclude<RiskLevel, 'none'> => l !== 'none');
  const breaks = [...levels.map((l) => thresholds[l]), Number.MAX_VALUE];
  const bands = isobands(featureCollection(pts), breaks, { zProperty: 'z' });
  const out = new Map<RiskLevel, MultiPolygon>();
  bands.features.forEach((f, i) => {
    const coords = f.geometry.coordinates.filter((poly) => poly.length > 0 && poly[0]!.length >= 4);
    if (coords.length) out.set(levels[i]!, { type: 'MultiPolygon', coordinates: coords });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 5. PM2.5 bands (Malaysian API-style categories)
// ---------------------------------------------------------------------------
export type Pm25Band = 'good' | 'moderate' | 'unhealthy' | 'very_unhealthy' | 'hazardous';

export function pm25Band(pm25: number, bands = DEFAULT_HAZE.pm25Bands): Pm25Band {
  if (pm25 <= bands.good) return 'good';
  if (pm25 <= bands.moderate) return 'moderate';
  if (pm25 <= bands.unhealthy) return 'unhealthy';
  if (pm25 <= bands.very_unhealthy) return 'very_unhealthy';
  return 'hazardous';
}

export const PM25_BAND_LABELS: Record<Pm25Band, { en: string; ms: string }> = {
  good: { en: 'Good', ms: 'Baik' },
  moderate: { en: 'Moderate', ms: 'Sederhana' },
  unhealthy: { en: 'Unhealthy', ms: 'Tidak Sihat' },
  very_unhealthy: { en: 'Very Unhealthy', ms: 'Sangat Tidak Sihat' },
  hazardous: { en: 'Hazardous', ms: 'Berbahaya' },
};

/**
 * Measured air beats modelled air: a monitoring station reading unhealthy PM2.5 now makes a zone
 * around it for the next few hours, whatever the smoke model says. Moderate readings are common
 * in towns and don't count on their own.
 */
export const MEASURED_LEVEL: Record<Pm25Band, RiskLevel> = {
  good: 'none',
  moderate: 'none',
  unhealthy: 'moderate',
  very_unhealthy: 'high',
  hazardous: 'severe',
};

export function measuredHazeZones(
  obs: AirQualityObsInput[],
  now: Date,
  opts: {
    bands?: HazeConfig['pm25Bands'];
    radiusKm?: number;
    maxAgeHours?: number;
    validHours?: number;
  } = {},
): HazardZone[] {
  const { bands = DEFAULT_HAZE.pm25Bands, radiusKm = 15, maxAgeHours = 3, validHours = 3 } = opts;
  const t = now.getTime();
  return obs.flatMap((o) => {
    if (t - Date.parse(o.observedAt) > maxAgeHours * HOUR) return [];
    const band = pm25Band(o.pm25, bands);
    const level = MEASURED_LEVEL[band];
    if (level === 'none') return [];
    const label = PM25_BAND_LABELS[band];
    const value = `${Math.round(o.pm25)} µg/m³`;
    return [
      {
        id: `haze:measured:${o.name}`,
        hazard: 'haze' as const,
        level,
        geometry: toMulti(circleArea(o.lat, o.lon, radiusKm)),
        validFrom: now.toISOString(),
        validTo: new Date(t + validHours * HOUR).toISOString(),
        confidence: 0.9,
        reason: `Measured PM2.5 ${value} (${label.en}) at ${o.name}.`,
        reasonMs: `PM2.5 diukur ${value} (${label.ms}) di ${o.name}.`,
        sourceRefs: ['DOE air quality (via WAQI)'],
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// 6. The engine
// ---------------------------------------------------------------------------
export interface HazeInput {
  now: Date;
  hotspots: Hotspot[];
  wind: WindSample[];
  pm25?: Pm25Sample[];
  /** Places named in "why" text, e.g. district centroids. */
  places?: Place[];
  config?: Partial<HazeConfig>;
}

export interface HazeResult {
  zones: HazardZone[];
  clusters: FireCluster[];
  stats: {
    hotspots: number;
    clusters: number;
    puffs: number;
    zonesBySlice: Record<string, number>;
  };
}

export function runHazeEngine(input: HazeInput): HazeResult {
  const cfg: HazeConfig = { ...DEFAULT_HAZE, ...input.config };
  const now = input.now.getTime();
  const clusters = clusterHotspots(input.hotspots, cfg.clusterRadiusKm, cfg.minConfidence);
  const stats = {
    hotspots: input.hotspots.length,
    clusters: clusters.length,
    puffs: 0,
    zonesBySlice: {} as Record<string, number>,
  };
  if (clusters.length === 0) return { zones: [], clusters, stats };

  const wind = new WindField(input.wind, cfg.windBlend850);
  const slices = [...cfg.timeSlicesH].sort((a, b) => a - b);
  const lastSlice = slices.at(-1)!;

  // Trajectories per (cluster, release time), computed once and reused by every slice.
  const releases: { cluster: FireCluster; releaseH: number; path: TrajectoryPoint[] }[] = [];
  for (const cluster of clusters) {
    for (let releaseH = -PAST_EMISSION_H; releaseH <= lastSlice; releaseH += RELEASE_STEP_H) {
      const maxAge = Math.min(cfg.trajectoryHours, lastSlice - releaseH);
      releases.push({
        cluster,
        releaseH,
        path: trajectory(wind, cluster.lat, cluster.lon, now + releaseH * HOUR, maxAge),
      });
    }
  }

  // Dominant transport for the "why" text: biggest cluster, first 24 h after now.
  const main = clusters[0]!;
  const mainPath = releases.find((r) => r.cluster === main && r.releaseH === 0)?.path ?? [];
  const end = mainPath[Math.min(24, mainPath.length - 1)] ?? mainPath[0]!;
  const travelled = haversineKm(main.lat, main.lon, end.lat, end.lon);
  const meanSpeed = end.ageH > 0 ? travelled / end.ageH : 0;
  const bearing = vectorToBearing({
    u: (end.lon - main.lon) * Math.cos((main.lat * Math.PI) / 180),
    v: end.lat - main.lat,
  }).bearing;

  const zones: HazardZone[] = [];
  const firstExposureH = new Map<string, number>();
  const sliceBands = new Map<number, Map<RiskLevel, MultiPolygon>>();
  for (const sliceH of slices) {
    const raster = makeRaster(cfg.domain, cfg.gridKm);
    for (const { cluster, releaseH, path } of releases) {
      const age = sliceH - releaseH;
      if (age < 0 || age > cfg.trajectoryHours) continue;
      const p = path[age];
      if (!p) continue;
      if (addPuff(raster, p.lat, p.lon, cluster.frpSum * RELEASE_STEP_H, age, cfg)) stats.puffs++;
    }
    const bands = rasterBands(raster, cfg.scoreThresholds);
    sliceBands.set(sliceH, bands);
    for (const place of input.places ?? []) {
      if (
        !firstExposureH.has(place.name) &&
        rasterAt(raster, place.lat, place.lon) >= cfg.scoreThresholds.low
      ) {
        firstExposureH.set(place.name, sliceH);
      }
    }
  }

  const regionsEn = [...new Set(clusters.slice(0, 3).map((c) => c.region))];
  const totalHotspots = clusters.reduce((a, c) => a + c.count, 0);

  slices.forEach((sliceH, i) => {
    const bands = sliceBands.get(sliceH)!;
    const validFrom = new Date(now + sliceH * HOUR).toISOString();
    const validTo = new Date(now + (slices[i + 1] ?? sliceH + 24) * HOUR).toISOString();
    stats.zonesBySlice[`+${sliceH}h`] = bands.size;
    for (const [level, geometry] of bands) {
      const affected = (input.places ?? []).filter((p) => pointInArea(p.lat, p.lon, geometry));
      const confidence = zoneConfidence(
        sliceH,
        geometry,
        input.pm25 ?? [],
        now + sliceH * HOUR,
        cfg,
      );
      const { en, ms } = hazeReason({
        hotspots: totalHotspots,
        regionsEn,
        bearing,
        speed: meanSpeed,
        sliceH,
        affected: affected.map((p) => ({
          name: p.name,
          firstH: firstExposureH.get(p.name) ?? sliceH,
        })),
      });
      zones.push({
        id: `haze:+${sliceH}h:${level}`,
        hazard: 'haze',
        level,
        geometry,
        validFrom,
        validTo,
        confidence,
        reason: en,
        reasonMs: ms,
        sourceRefs: ['NASA FIRMS', 'Open-Meteo wind forecast', 'Open-Meteo air quality'],
      });
    }
  });
  return { zones, clusters, stats };
}

/** Lead time lowers confidence; the PM2.5 forecast inside the zone raises or lowers it. */
function zoneConfidence(
  sliceH: number,
  area: MultiPolygon,
  pm25: Pm25Sample[],
  timeMs: number,
  cfg: HazeConfig,
): number {
  let c = 0.65 - 0.15 * (sliceH / 72);
  const [w, s, e, n] = areaBbox(area);
  const near = pm25.filter(
    (p) =>
      Math.abs(Date.parse(p.validAt) - timeMs) <= 1.5 * HOUR &&
      p.lon >= w &&
      p.lon <= e &&
      p.lat >= s &&
      p.lat <= n &&
      pointInArea(p.lat, p.lon, area),
  );
  if (near.length) {
    const mean = near.reduce((a, p) => a + p.pm25, 0) / near.length;
    if (mean > cfg.pm25Bands.moderate) c += 0.2;
    else if (mean <= cfg.pm25Bands.good) c -= 0.2;
  }
  return Math.round(Math.min(0.95, Math.max(0.1, c)) * 100) / 100;
}

export function hazeReason(p: {
  hotspots: number;
  regionsEn: string[];
  bearing: number;
  speed: number;
  sliceH: number;
  affected: { name: string; firstH: number }[];
}): { en: string; ms: string } {
  const where = p.regionsEn.join(' and ');
  const whereMs = p.regionsEn.map(regionNameMs).join(' dan ');
  const speed = Math.round(p.speed);
  let en = `Smoke from ${p.hotspots} fire hotspots in ${where}, carried ${compass(p.bearing)} by ~${speed} km/h winds.`;
  let ms = `Asap daripada ${p.hotspots} titik panas kebakaran di ${whereMs}, dibawa ke arah ${compassMs(p.bearing)} oleh angin ~${speed} km/j.`;
  if (p.affected.length) {
    const names = p.affected
      .slice(0, 3)
      .map((a) => a.name)
      .join(', ');
    const firstH = Math.min(...p.affected.map((a) => a.firstH));
    if (firstH <= 0) {
      en += ` Affecting ${names} now.`;
      ms += ` Sedang menjejaskan ${names}.`;
    } else {
      en += ` Expected over ${names} within ~${firstH} hours.`;
      ms += ` Dijangka melanda ${names} dalam ~${firstH} jam.`;
    }
  }
  return { en, ms };
}
