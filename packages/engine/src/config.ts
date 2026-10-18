// Engine configuration. Defaults mirror the seeded `settings` rows; the worker passes the admin's
// current values through fromSettings(), so every threshold stays admin-configurable.
import type { RiskLevel } from '@jagasekitar/shared';

export type Thresholds = Record<Exclude<RiskLevel, 'none'>, number>;

export interface HazeConfig {
  clusterRadiusKm: number;
  minConfidence: 'l' | 'n' | 'h';
  trajectoryHours: number;
  /** Weight of 850 hPa wind vs 10 m wind (long-range transport happens aloft). */
  windBlend850: number;
  spreadKmh: number;
  maxHalfWidthKm: number;
  gridKm: number;
  timeSlicesH: number[];
  scoreThresholds: Thresholds;
  pm25Bands: { good: number; moderate: number; unhealthy: number; very_unhealthy: number };
  /** Area rasterized for zones [W, S, E, N]; fires outside it still contribute. */
  domain: [number, number, number, number];
  /** e-folding time for smoke dilution/deposition, hours. */
  decayHours: number;
}

export interface FloodConfig {
  hourlyBandsMm: { light: number; moderate: number; heavy: number; very_heavy: number };
  severe3hMm: number;
  high3hMm: number;
  highForecast24hMm: number;
  highCumulative3dMm: number;
  bufferKm: Thresholds;
  officialAlertMinLevel: RiskLevel;
  /** Readings older than this are ignored (e.g. a gauge that stopped reporting). */
  maxRainAgeHours: number;
  maxWaterAgeHours: number;
  /** A rising river within this distance of a rain station counts for the severe rule. */
  nearbyRiverKm: number;
  validHours: number;
  /** GloFAS forecast peak reaching a river's 2/5/20-year return period → this level at the gauge. */
  riverFlowLevels: { rp2: RiskLevel; rp5: RiskLevel; rp20: RiskLevel };
  /** Ignore GloFAS cells whose 2-year flow is below this (m³/s): likely not the gauge's river. */
  riverFlowMinRp2: number;
}

export interface DiseaseConfig {
  outbreakMinCount: number;
  outbreakRatio: number;
  floodLinked: string[];
  hazeLinked: string[];
  /** Cases per 100k in 7 days that make an outbreak severe on its own. */
  severePer100k: number;
  validHours: number;
}

export const DEFAULT_HAZE: HazeConfig = {
  clusterRadiusKm: 10,
  minConfidence: 'n',
  trajectoryHours: 72,
  windBlend850: 0.7,
  spreadKmh: 5,
  maxHalfWidthKm: 150,
  gridKm: 5,
  timeSlicesH: [0, 12, 24, 48, 72],
  scoreThresholds: { low: 0.5, moderate: 2, high: 5, severe: 10 },
  pm25Bands: { good: 15, moderate: 35, unhealthy: 55, very_unhealthy: 150 },
  domain: [99, 0.5, 105, 7.5],
  decayHours: 48,
};

export const DEFAULT_FLOOD: FloodConfig = {
  hourlyBandsMm: { light: 1, moderate: 11, heavy: 31, very_heavy: 61 },
  severe3hMm: 60,
  high3hMm: 60,
  highForecast24hMm: 100,
  highCumulative3dMm: 150,
  bufferKm: { low: 3, moderate: 4, high: 6, severe: 8 },
  officialAlertMinLevel: 'high',
  maxRainAgeHours: 3,
  maxWaterAgeHours: 6,
  nearbyRiverKm: 20,
  validHours: 6,
  // GloFAS's own colours: 2-year medium, 5-year high, 20-year severe. Capped at high here because
  // a ~5 km cell may not sit on the gauge's exact river.
  riverFlowLevels: { rp2: 'moderate', rp5: 'high', rp20: 'high' },
  riverFlowMinRp2: 2,
};

export const DEFAULT_DISEASE: DiseaseConfig = {
  outbreakMinCount: 5,
  outbreakRatio: 2,
  floodLinked: ['LEPTO', 'CHOLERA', 'TYPHOID', 'DIARR', 'DENGUE'],
  hazeLinked: ['ARI', 'CONJ'],
  severePer100k: 50,
  validHours: 24,
};

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Merge a snake_case settings row (as stored in `settings.value`) over defaults. */
export function fromSettings<T extends object>(defaults: T, value: unknown): T {
  if (!value || typeof value !== 'object') return defaults;
  const out = { ...defaults } as Record<string, unknown>;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = camel(k);
    if (key in defaults && v != null) out[key] = v;
  }
  return out as T;
}
