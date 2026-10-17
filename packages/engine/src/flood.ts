// Flood engine: transparent rules on JPS observations plus the Open-Meteo rain forecast.
//
// Per station (all numbers admin-configurable, see FloodConfig):
//   water level: Danger → severe, Warning → high, Alert → moderate
//   rain:        severe   > 60 mm in 3 h AND a nearby river is rising
//                high     > 60 mm in 3 h, OR forecast 24 h > 100 mm on top of > 150 mm in 3 days
//                moderate heavy rain (≥ 31 mm/h) observed or forecast
//                low      moderate rain (≥ 11 mm/h) observed or forecast
//   official JPS alert: at least `officialAlertMinLevel` (default high) at the alert's station
// Zones: a circle around each station (radius grows with level), clipped to its district, then
// merged per (district, level) so each zone's "why" lists the stations behind it.
import type { HazardZone, RiskLevel } from '@jagasekitar/shared';
import { maxRisk, riskRank } from '@jagasekitar/shared';
import { DEFAULT_FLOOD, type FloodConfig } from './config';
import { haversineKm } from './geo';
import { circleArea, intersectAreas, toMulti, unionAll, type Area } from './geom';
import type {
  District,
  OfficialAlertInput,
  PrecipSample,
  RainStationInput,
  WaterStationInput,
} from './types';

const HOUR = 3600_000;
const FORECAST_MAX_KM = 30;

const WATER_LEVEL: Record<WaterStationInput['status'], RiskLevel> = {
  normal: 'none',
  alert: 'moderate',
  warning: 'high',
  danger: 'severe',
};
const WATER_STATUS_LABEL: Record<WaterStationInput['status'], { en: string; ms: string }> = {
  normal: { en: 'Normal', ms: 'Normal' },
  alert: { en: 'Alert', ms: 'Waspada' },
  warning: { en: 'Warning', ms: 'Amaran' },
  danger: { en: 'Danger', ms: 'Bahaya' },
};
const TREND_MS = { rising: 'meningkat', falling: 'menurun', steady: 'stabil' } as const;

export interface StationRisk {
  kind: 'rain' | 'water' | 'alert';
  id: string;
  name: string;
  district: string | null;
  lat: number;
  lon: number;
  level: RiskLevel;
  confidence: number;
  reasonEn: string;
  reasonMs: string;
}

export interface FloodInput {
  now: Date;
  rain: RainStationInput[];
  water: WaterStationInput[];
  forecast?: PrecipSample[];
  alerts?: OfficialAlertInput[];
  districts?: District[];
  config?: Partial<FloodConfig>;
}

export interface FloodResult {
  zones: HazardZone[];
  stations: StationRisk[];
  stats: { rainStations: number; waterStations: number; staleSkipped: number; atRisk: number };
}

export interface StationForecast {
  next6h: number;
  next24h: number;
  maxHourly: number;
}

/** Forecast rain at the nearest grid point (within 30 km) over the next 6 and 24 hours. */
export function forecastAt(
  lat: number,
  lon: number,
  samples: PrecipSample[],
  nowMs: number,
): StationForecast | null {
  let best: { lat: number; lon: number } | null = null;
  let bestKm = FORECAST_MAX_KM;
  const seen = new Set<string>();
  for (const s of samples) {
    const key = `${s.lat},${s.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d <= bestKm) {
      bestKm = d;
      best = s;
    }
  }
  if (!best) return null;
  let next6h = 0;
  let next24h = 0;
  let maxHourly = 0;
  for (const s of samples) {
    if (s.lat !== best.lat || s.lon !== best.lon) continue;
    const dt = Date.parse(s.validAt) - nowMs;
    if (dt < 0 || dt >= 24 * HOUR) continue;
    next24h += s.precip;
    if (dt < 6 * HOUR) next6h += s.precip;
    maxHourly = Math.max(maxHourly, s.precip);
  }
  return { next6h, next24h, maxHourly };
}

const fmt = (mm: number) => `${Math.round(mm)} mm`;

export function assessRainStation(
  s: RainStationInput,
  fc: StationForecast | null,
  nearbyRising: WaterStationInput | undefined,
  cfg: FloodConfig,
): StationRisk {
  const heavy = cfg.hourlyBandsMm.heavy;
  const moderate = cfg.hourlyBandsMm.moderate;
  const r1 = s.rain1h ?? 0;
  const r3 = s.rain3h ?? 0;
  const r72 = s.rain72h ?? 0;
  let level: RiskLevel = 'none';
  const en: string[] = [];
  const ms: string[] = [];
  let confidence = 0.75;

  if (r3 > cfg.severe3hMm && nearbyRising) {
    level = 'severe';
    const river = nearbyRising.river ?? nearbyRising.name;
    en.push(`${fmt(r3)} rain in 3 hours at ${s.name} and ${river} is rising`);
    ms.push(`${fmt(r3)} hujan dalam 3 jam di ${s.name} dan paras ${river} meningkat`);
    confidence = 0.85;
  } else if (r3 > cfg.high3hMm) {
    level = 'high';
    en.push(`${fmt(r3)} rain in 3 hours at ${s.name}`);
    ms.push(`${fmt(r3)} hujan dalam 3 jam di ${s.name}`);
  } else if (fc && fc.next24h > cfg.highForecast24hMm && r72 > cfg.highCumulative3dMm) {
    level = 'high';
    en.push(
      `${fmt(fc.next24h)} more rain forecast in 24 hours after ${fmt(r72)} in 3 days near ${s.name}`,
    );
    ms.push(
      `${fmt(fc.next24h)} hujan lagi diramal dalam 24 jam selepas ${fmt(r72)} dalam 3 hari berhampiran ${s.name}`,
    );
    confidence = 0.6;
  } else if (r1 >= heavy || (fc && fc.maxHourly >= heavy)) {
    level = 'moderate';
    if (r1 >= heavy) {
      en.push(`Heavy rain at ${s.name}: ${fmt(r1)} in the last hour`);
      ms.push(`Hujan lebat di ${s.name}: ${fmt(r1)} dalam sejam lalu`);
    } else {
      en.push(`Heavy rain (up to ${fmt(fc!.maxHourly)}/h) forecast near ${s.name}`);
      ms.push(`Hujan lebat (sehingga ${fmt(fc!.maxHourly)}/j) diramal berhampiran ${s.name}`);
      confidence = 0.5;
    }
  } else if (r1 >= moderate || (fc && fc.maxHourly >= moderate)) {
    level = 'low';
    if (r1 >= moderate) {
      en.push(`Moderate rain at ${s.name}: ${fmt(r1)} in the last hour`);
      ms.push(`Hujan sederhana di ${s.name}: ${fmt(r1)} dalam sejam lalu`);
    } else {
      en.push(`Moderate rain forecast near ${s.name}`);
      ms.push(`Hujan sederhana diramal berhampiran ${s.name}`);
      confidence = 0.5;
    }
  }
  return {
    kind: 'rain',
    id: s.stationId,
    name: s.name,
    district: s.district,
    lat: s.lat,
    lon: s.lon,
    level,
    confidence,
    reasonEn: en.join('; '),
    reasonMs: ms.join('; '),
  };
}

export function assessWaterStation(s: WaterStationInput): StationRisk {
  const level = WATER_LEVEL[s.status];
  const river = s.river ?? s.name;
  const label = WATER_STATUS_LABEL[s.status];
  const trendEn = s.trend && s.trend !== 'steady' ? ` (${s.trend})` : '';
  const trendMs = s.trend && s.trend !== 'steady' ? ` (${TREND_MS[s.trend]})` : '';
  return {
    kind: 'water',
    id: s.stationId,
    name: s.name,
    district: s.district,
    lat: s.lat,
    lon: s.lon,
    level,
    confidence: 0.85,
    reasonEn: `${river} at ${label.en} level${trendEn} at ${s.name}`,
    reasonMs: `${river} pada paras ${label.ms}${trendMs} di ${s.name}`,
  };
}

export function runFloodEngine(input: FloodInput): FloodResult {
  const cfg: FloodConfig = { ...DEFAULT_FLOOD, ...input.config };
  const now = input.now.getTime();
  const fresh = (iso: string, maxH: number) => now - Date.parse(iso) <= maxH * HOUR;

  const rain = input.rain.filter((r) => fresh(r.observedAt, cfg.maxRainAgeHours));
  const water = input.water.filter((w) => fresh(w.observedAt, cfg.maxWaterAgeHours));
  const staleSkipped = input.rain.length - rain.length + (input.water.length - water.length);

  const risks: StationRisk[] = [];
  for (const w of water) risks.push(assessWaterStation(w));
  for (const r of rain) {
    const rising = water.find(
      (w) => w.trend === 'rising' && haversineKm(r.lat, r.lon, w.lat, w.lon) <= cfg.nearbyRiverKm,
    );
    risks.push(
      assessRainStation(r, forecastAt(r.lat, r.lon, input.forecast ?? [], now), rising, cfg),
    );
  }
  for (const a of input.alerts ?? []) {
    // Use the alert's own coordinates, or the matching station's.
    const station = [...water, ...rain].find((s) => s.stationId === a.stationId);
    const lat = a.lat ?? station?.lat;
    const lon = a.lon ?? station?.lon;
    if (lat == null || lon == null) continue;
    risks.push({
      kind: 'alert',
      id: a.stationId ?? a.title,
      name: station?.name ?? a.title,
      district: a.district ?? station?.district ?? null,
      lat,
      lon,
      level: maxRisk(a.level, cfg.officialAlertMinLevel),
      confidence: 0.9,
      reasonEn: `Official JPS alert: ${a.title}`,
      reasonMs: `Amaran rasmi JPS: ${a.title}`,
    });
  }

  const atRisk = risks.filter((r) => r.level !== 'none');
  const zones = buildZones(atRisk, input.districts ?? [], cfg, now);
  return {
    zones,
    stations: risks,
    stats: {
      rainStations: rain.length,
      waterStations: water.length,
      staleSkipped,
      atRisk: atRisk.length,
    },
  };
}

function buildZones(
  risks: StationRisk[],
  districts: District[],
  cfg: FloodConfig,
  now: number,
): HazardZone[] {
  const byKey = new Map<string, StationRisk[]>();
  for (const r of risks) {
    const key = `${r.district ?? 'unknown'}|${r.level}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const zones: HazardZone[] = [];
  for (const [key, group] of byKey) {
    const [districtName, level] = key.split('|') as [string, RiskLevel];
    const district = districts.find((d) => d.name === districtName);
    const radius = cfg.bufferKm[level as Exclude<RiskLevel, 'none'>];
    const areas: Area[] = group.map((r) => {
      const c = circleArea(r.lat, r.lon, radius);
      // Clip to the district so a buffer doesn't spill across a watershed/district line.
      return (district?.geometry && intersectAreas(c, district.geometry)) || c;
    });
    const geometry = unionAll(areas);
    if (!geometry) continue;
    const ordered = [...group].sort(
      (a, b) => riskRank(b.level) - riskRank(a.level) || b.confidence - a.confidence,
    );
    const reasons = [...new Set(ordered.map((r) => r.reasonEn))].slice(0, 3);
    const reasonsMs = [...new Set(ordered.map((r) => r.reasonMs))].slice(0, 3);
    const where = districtName === 'unknown' ? '' : ` (${districtName})`;
    zones.push({
      id: `flood:${districtName}:${level}`,
      hazard: 'flood',
      level,
      geometry: toMulti(geometry),
      validFrom: new Date(now).toISOString(),
      validTo: new Date(now + cfg.validHours * HOUR).toISOString(),
      confidence: Math.max(...group.map((r) => r.confidence)),
      reason: `Flood risk ${level}${where}: ${reasons.join('. ')}.`,
      reasonMs: `Risiko banjir ${LEVEL_MS[level]}${where}: ${reasonsMs.join('. ')}.`,
      sourceRefs: [
        ...new Set(
          group.map((r) =>
            r.kind === 'water'
              ? 'JPS water level'
              : r.kind === 'alert'
                ? 'JPS current alerts'
                : 'JPS rainfall',
          ),
        ),
        ...(group.some((r) => r.kind === 'rain') ? ['Open-Meteo rain forecast'] : []),
      ],
    });
  }
  return zones.sort((a, b) => riskRank(b.level) - riskRank(a.level));
}

const LEVEL_MS: Record<RiskLevel, string> = {
  none: 'tiada',
  low: 'rendah',
  moderate: 'sederhana',
  high: 'tinggi',
  severe: 'teruk',
};
