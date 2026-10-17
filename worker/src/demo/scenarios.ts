// Demo scenarios (definitions in supabase/seed/demo/*.json) turned into table rows.
// Pure and deterministic: same scenario + demo time → same data, so the pitch is repeatable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type ScenarioId = 'riau_haze' | 'kerian_flood' | 'post_flood_disease';

export interface DemoState {
  enabled: boolean;
  scenario: ScenarioId | null;
  speed: number;
  started_at: string | null;
  offset_minutes: number;
}

export interface HazeScenario {
  id: 'riau_haze';
  fires: {
    seed: number;
    clusters: {
      name: string;
      lat: number;
      lon: number;
      spreadDeg: number;
      count: number;
      frpMean: number;
    }[];
  };
  /** Before `shiftHours` after the scenario starts the `before` wind blows; then the main one. */
  wind: {
    before: { fromDeg: number; speed850Kmh: number; speed10mKmh: number };
    shiftHours: number;
    fromDeg: number;
    speed850Kmh: number;
    speed10mKmh: number;
    wobbleDeg: number;
  };
  pm25: {
    baseline: number;
    peak: number;
    centre: [number, number];
    radiusDeg: number;
    rampHours: number;
  };
}

export interface FloodKeyframe {
  t: number;
  rain1h: number;
  rain3h: number;
  rain24h: number;
  rain72h: number;
  waterStage: number;
}

export interface FloodScenario {
  id: 'kerian_flood';
  stations: { rain: string[]; water: string[] };
  keyframes: FloodKeyframe[];
}

export interface DiseaseScenario {
  id: 'post_flood_disease';
  floodAtMinute: number;
  rampMinutes: number;
  note: string;
  facilities: string[];
  diseases: Record<string, { baselinePerWeek: number; lastWeekPeak: number[] }>;
}

const DIR = fileURLToPath(new URL('../../../supabase/seed/demo/', import.meta.url));

export function loadScenario<T>(id: ScenarioId): T {
  return JSON.parse(readFileSync(`${DIR}${id}.json`, 'utf8')) as T;
}

/** Demo minutes elapsed: real time since start × speed, plus any fast-forward. */
export function demoMinutes(state: DemoState, now: Date): number {
  const started = state.started_at ? Date.parse(state.started_at) : now.getTime();
  const real = Math.max(0, (now.getTime() - started) / 60_000);
  return real * Math.max(1, state.speed || 1) + (state.offset_minutes || 0);
}

/** Linear interpolation between keyframes; clamps before the first and after the last. */
export function interpolate(frames: FloodKeyframe[], t: number): FloodKeyframe {
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  if (t <= sorted[0]!.t) return { ...sorted[0]!, t };
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (t <= b.t) {
      const k = (t - a.t) / (b.t - a.t);
      const lerp = (x: number, y: number) => +(x + (y - x) * k).toFixed(2);
      return {
        t,
        rain1h: lerp(a.rain1h, b.rain1h),
        rain3h: lerp(a.rain3h, b.rain3h),
        rain24h: lerp(a.rain24h, b.rain24h),
        rain72h: lerp(a.rain72h, b.rain72h),
        waterStage: lerp(a.waterStage, b.waterStage),
      };
    }
  }
  return { ...sorted.at(-1)!, t };
}

/** Deterministic pseudo-random numbers (Park–Miller). */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ---------------------------------------------------------------------------
// Haze
// ---------------------------------------------------------------------------
export function hazeHotspots(def: HazeScenario, now: Date) {
  const r = rng(def.fires.seed);
  const rows: {
    source: string;
    lat: number;
    lon: number;
    brightness: number;
    frp: number;
    confidence: string;
    acquired_at: string;
  }[] = [];
  for (const c of def.fires.clusters) {
    for (let i = 0; i < c.count; i++) {
      // Spread in a rough disc; detections over the last 36 h (satellite overpasses ~every 6 h).
      const angle = r() * 2 * Math.PI;
      const dist = Math.sqrt(r()) * c.spreadDeg;
      const hoursAgo = Math.floor(r() * 6) * 6 + 1;
      rows.push({
        source: 'demo',
        lat: +(c.lat + dist * Math.sin(angle)).toFixed(4),
        lon: +(c.lon + dist * Math.cos(angle)).toFixed(4),
        brightness: +(320 + r() * 50).toFixed(1),
        frp: +(c.frpMean * (0.4 + r() * 1.2)).toFixed(1),
        confidence: r() < 0.25 ? 'h' : 'n',
        acquired_at: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
      });
    }
  }
  return rows;
}

/** 1° wind grid over the haze bbox and 0.5° PM2.5 over the Peninsula, 3-hourly, now−3 h…now+75 h. */
export function hazeWeather(def: HazeScenario, now: Date) {
  const start = Math.floor(now.getTime() / (3 * 3600_000)) * 3 * 3600_000 - 3 * 3600_000;
  const wind: Record<string, unknown>[] = [];
  const pm: Record<string, unknown>[] = [];
  for (let h = 0; h <= 78; h += 3) {
    const t = start + h * 3600_000;
    const validAt = new Date(t).toISOString();
    for (let lat = -6; lat <= 8; lat++) {
      for (let lon = 95; lon <= 120; lon++) {
        const wobble = Math.sin(lat * 0.6 + lon * 0.25 + h / 18) * def.wind.wobbleDeg;
        // The wind turns at shiftHours: smoke first drifts away, then heads for Perak.
        const w = t < now.getTime() + def.wind.shiftHours * 3600_000 ? def.wind.before : def.wind;
        wind.push({
          lat,
          lon,
          valid_at: validAt,
          wind_dir_850: +(((w.fromDeg + wobble) % 360) + 360) % 360,
          wind_speed_850: +(w.speed850Kmh + 2 * Math.cos(lat + h / 12)).toFixed(1),
          wind_dir_10m: +(((w.fromDeg + 10 + wobble) % 360) + 360) % 360,
          wind_speed_10m: w.speed10mKmh,
        });
      }
    }
    // Smoke builds over the Peninsula as the plume arrives.
    const ramp = Math.min(
      1,
      Math.max(0, (t - now.getTime()) / 3600_000 / def.pm25.rampHours + 0.35),
    );
    for (let lat = 1; lat <= 7; lat += 0.5) {
      for (let lon = 99.5; lon <= 104.5; lon += 0.5) {
        const d =
          Math.hypot(lon - def.pm25.centre[0], lat - def.pm25.centre[1]) / def.pm25.radiusDeg;
        const value =
          def.pm25.baseline + (def.pm25.peak - def.pm25.baseline) * ramp * Math.exp(-d * d);
        pm.push({
          lat,
          lon,
          valid_at: validAt,
          pm2_5: +value.toFixed(1),
          pm10: +(value * 1.5).toFixed(1),
        });
      }
    }
  }
  return { wind, pm };
}

// ---------------------------------------------------------------------------
// Flood
// ---------------------------------------------------------------------------
export interface Thresholds {
  normal_level: number | null;
  alert_level: number | null;
  warning_level: number | null;
  danger_level: number | null;
}

/** Water level for a stage: 0 = normal, 1 = Alert, 2 = Warning, 3 = Danger (interpolated). */
export function levelForStage(t: Thresholds, stage: number): number | null {
  const marks = [t.normal_level, t.alert_level, t.warning_level, t.danger_level];
  if (marks.some((m) => m == null)) return null;
  const m = marks as number[];
  const step = Math.max(0.1, m[3]! - m[2]!); // used beyond Danger
  if (stage >= 3) return +(m[3]! + (stage - 3) * step).toFixed(2);
  const i = Math.floor(stage);
  return +(m[i]! + (m[i + 1]! - m[i]!) * (stage - i)).toFixed(2);
}

export function statusForLevel(
  t: Thresholds,
  level: number,
): 'normal' | 'alert' | 'warning' | 'danger' {
  if (t.danger_level != null && level >= t.danger_level) return 'danger';
  if (t.warning_level != null && level >= t.warning_level) return 'warning';
  if (t.alert_level != null && level >= t.alert_level) return 'alert';
  return 'normal';
}

// ---------------------------------------------------------------------------
// Disease
// ---------------------------------------------------------------------------
/** Case reports for one facility: a quiet 28-day baseline, then a last week scaled by progress (0–1). */
export function diseaseReports(
  def: DiseaseScenario,
  facilityId: string,
  today: string,
  progress: number,
) {
  const day = (offset: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10);
  const rows: {
    facility_id: string;
    disease_code: string;
    report_date: string;
    new_cases: number;
    suspected_cases: number;
    notes: string;
    status: string;
  }[] = [];
  for (const [code, d] of Object.entries(def.diseases)) {
    // Baseline: spread baselinePerWeek over days 8–35 ago.
    for (let w = 0; w < 4; w++) {
      for (let k = 0; k < d.baselinePerWeek; k++) {
        rows.push({
          facility_id: facilityId,
          disease_code: code,
          report_date: day(8 + w * 7 + k),
          new_cases: 1,
          suspected_cases: 0,
          notes: def.note,
          status: 'submitted',
        });
      }
    }
    // Last 7 days, oldest first in lastWeekPeak; today is offset 0.
    d.lastWeekPeak.forEach((peak, i) => {
      const cases = Math.round(peak * progress);
      if (cases > 0) {
        rows.push({
          facility_id: facilityId,
          disease_code: code,
          report_date: day(6 - i),
          new_cases: cases,
          suspected_cases: Math.round(cases / 2),
          notes: def.note,
          status: 'submitted',
        });
      }
    });
  }
  return rows;
}
