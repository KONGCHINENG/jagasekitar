// GloFAS river discharge (Copernicus) via the Open-Meteo Flood API, one point per JPS river gauge.
// Like GloFAS's own warnings, we compare the highest forecast day in the next few days with the
// river's return periods: the flow reached in a typical year (2-year), once in 5 and once in 20
// years, from ~30 years of GloFAS reanalysis. (A ratio to the recent median flagged every river
// when the monsoon started, because the months before were the dry season.)
// GloFAS cells are ~5 km, so the cell nearest a gauge may not sit on the gauge's exact river;
// the flood engine never takes it above "high" on its own.

export interface ReturnPeriods {
  rp2: number;
  rp5: number;
  rp20: number;
  years: number;
}

export interface RiverFlow {
  stationId: string;
  cellLat: number;
  cellLon: number;
  /** Median of the past 92 days, for context. */
  baselineMedian: number;
  peak: number;
  peakDate: string;
  /** peak / rp2 when return periods are known, else peak / baselineMedian. */
  ratio: number;
  returnPeriods: ReturnPeriods | null;
  /** Highest return period the peak reaches: 0, 2, 5 or 20. */
  exceeded: 0 | 2 | 5 | 20;
  series: { date: string; q: number; forecast: boolean }[];
}

/** Linear-interpolated quantile (q in 0..1) of a non-empty list. */
export function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/**
 * Return periods from daily history: the T-year flow is the (1 − 1/T) quantile of the annual
 * maxima (empirical; needs at least 10 complete-ish years).
 */
export function parseReturnPeriods(json: string, count: number): (ReturnPeriods | null)[] {
  const data = JSON.parse(json) as unknown;
  const points = (Array.isArray(data) ? data : [data]) as RawPoint[];
  if (points.length !== count) {
    throw new Error(`GloFAS history: asked for ${count} points, got ${points.length}`);
  }
  return points.map((p) => {
    const times = p.daily?.time ?? [];
    const q = p.daily?.river_discharge ?? [];
    const maxByYear = new Map<string, { max: number; days: number }>();
    times.forEach((date, i) => {
      const v = q[i];
      if (typeof v !== 'number') return;
      const y = date.slice(0, 4);
      const cur = maxByYear.get(y) ?? { max: -Infinity, days: 0 };
      maxByYear.set(y, { max: Math.max(cur.max, v), days: cur.days + 1 });
    });
    const maxima = [...maxByYear.values()].filter((y) => y.days >= 300).map((y) => y.max);
    if (maxima.length < 10) return null;
    return {
      rp2: round(quantile(maxima, 0.5)),
      rp5: round(quantile(maxima, 0.8)),
      rp20: round(quantile(maxima, 0.95)),
      years: maxima.length,
    };
  });
}

export function exceededPeriod(peak: number, rp: ReturnPeriods | null): RiverFlow['exceeded'] {
  if (!rp) return 0;
  if (peak >= rp.rp20) return 20;
  if (peak >= rp.rp5) return 5;
  if (peak >= rp.rp2) return 2;
  return 0;
}

interface RawPoint {
  latitude?: number;
  longitude?: number;
  daily?: { time?: string[]; river_discharge?: (number | null)[] };
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const addDays = (isoDate: string, n: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * `stationIds[i]` belongs to the i-th requested point (and `returnPeriods[i]`, when given).
 * `today` is a UTC date (YYYY-MM-DD); the forecast window is today plus `lookaheadDays`.
 */
export function parseRiverFlow(
  json: string,
  stationIds: string[],
  today: string,
  lookaheadDays = 3,
  returnPeriods: (ReturnPeriods | null)[] = [],
): RiverFlow[] {
  const data = JSON.parse(json) as unknown;
  const points = (Array.isArray(data) ? data : [data]) as RawPoint[];
  if (points.length !== stationIds.length) {
    throw new Error(`GloFAS: asked for ${stationIds.length} points, got ${points.length}`);
  }
  const last = addDays(today, lookaheadDays);
  const out: RiverFlow[] = [];
  points.forEach((p, i) => {
    const times = p.daily?.time ?? [];
    const q = p.daily?.river_discharge ?? [];
    if (p.latitude == null || p.longitude == null || !times.length) return;
    const series = times
      .map((date, k) => ({ date, q: q[k], forecast: date >= today }))
      .filter((s): s is { date: string; q: number; forecast: boolean } => typeof s.q === 'number');
    const past = series.filter((s) => !s.forecast).map((s) => s.q);
    const ahead = series.filter((s) => s.forecast && s.date <= last);
    const baseline = median(past);
    if (!ahead.length || !(baseline > 0)) return;
    const peak = ahead.reduce((a, b) => (b.q > a.q ? b : a));
    const rp = returnPeriods[i] ?? null;
    out.push({
      stationId: stationIds[i]!,
      cellLat: p.latitude,
      cellLon: p.longitude,
      baselineMedian: round(baseline),
      peak: round(peak.q),
      peakDate: peak.date,
      ratio: round(peak.q / (rp?.rp2 || baseline)),
      returnPeriods: rp,
      exceeded: exceededPeriod(peak.q, rp),
      series: series.map((s) => ({ ...s, q: round(s.q) })),
    });
  });
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
