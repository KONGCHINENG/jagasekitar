// Calibration: replay history through a flood rule and score it against what really happened.
//
// The rule tuned here is the flood engine's forecast rule (see flood.ts):
//   high risk when rain forecast for the next 24 h > highForecast24hMm
//            AND rain in the previous 3 days > highCumulative3dMm
// Replay uses reanalysis rain (ERA5, a smoothed grid like the live Open-Meteo forecast) and
// treats the next day's actual rain as the forecast ("perfect forecast"), so real-world skill
// is somewhat lower than reported.
//
// Scoring is per event and per alert episode (consecutive alert days in one district):
//   hit         an event with an alert from `leadDays` before its start until its end
//   miss        an event with no such alert
//   false alarm an alert episode with no event in that district from its start to
//               `leadDays` days after its end
// CSI (critical success index) = hits / (hits + misses + false alarms) is the main score.

export interface DistrictDay {
  district: string;
  /** YYYY-MM-DD */
  date: string;
  /** Rain on the previous 3 days (mm). */
  rainPrev3d: number;
  /** Rain on the next day (mm): the "forecast" in a perfect-forecast replay. */
  rainNext1d: number;
}

export interface TruthEvent {
  district: string;
  start: string;
  end: string;
}

export interface RainRuleParams {
  highForecast24hMm: number;
  highCumulative3dMm: number;
}

export interface Skill {
  hits: number;
  misses: number;
  falseAlarms: number;
  /** Critical success index, 0..1 (higher is better). */
  csi: number;
  /** Probability of detection, 0..1. */
  pod: number;
  /** False alarm ratio among alert episodes, 0..1. */
  far: number;
  /** Mean days of warning before an event starts (0 = alert on the first day). */
  meanLeadDays: number | null;
  alertDays: number;
}

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export const ruleFires = (d: DistrictDay, p: RainRuleParams) =>
  d.rainNext1d > p.highForecast24hMm && d.rainPrev3d > p.highCumulative3dMm;

/** Consecutive alert days per district → episodes [start, end] (ms). */
function episodes(alertDays: DistrictDay[]): Map<string, [number, number][]> {
  const byDistrict = new Map<string, number[]>();
  for (const d of alertDays) {
    byDistrict.set(d.district, [...(byDistrict.get(d.district) ?? []), toMs(d.date)]);
  }
  const out = new Map<string, [number, number][]>();
  for (const [district, days] of byDistrict) {
    days.sort((a, b) => a - b);
    const eps: [number, number][] = [];
    for (const t of days) {
      const last = eps.at(-1);
      if (last && t - last[1] <= DAY) last[1] = t;
      else eps.push([t, t]);
    }
    out.set(district, eps);
  }
  return out;
}

/** Skill of one parameter set. Only events inside the replayed period should be passed in. */
export function scoreRule(
  days: DistrictDay[],
  events: TruthEvent[],
  params: RainRuleParams,
  leadDays = 2,
): Skill {
  const alerts = days.filter((d) => ruleFires(d, params));
  const eps = episodes(alerts);
  let hits = 0;
  let misses = 0;
  const leads: number[] = [];
  for (const e of events) {
    const from = toMs(e.start) - leadDays * DAY;
    const to = toMs(e.end);
    const hitDays = alerts
      .filter((a) => a.district === e.district)
      .map((a) => toMs(a.date))
      .filter((t) => t >= from && t <= to);
    if (hitDays.length) {
      hits++;
      leads.push(Math.max(0, (toMs(e.start) - Math.min(...hitDays)) / DAY));
    } else {
      misses++;
    }
  }
  let falseAlarms = 0;
  let episodeCount = 0;
  for (const [district, list] of eps) {
    for (const [s, e] of list) {
      episodeCount++;
      const matched = events.some(
        (ev) =>
          ev.district === district && toMs(ev.start) <= e + leadDays * DAY && toMs(ev.end) >= s,
      );
      if (!matched) falseAlarms++;
    }
  }
  const denom = hits + misses + falseAlarms;
  return {
    hits,
    misses,
    falseAlarms,
    csi: denom ? hits / denom : 0,
    pod: hits + misses ? hits / (hits + misses) : 0,
    far: episodeCount ? falseAlarms / episodeCount : 0,
    meanLeadDays: leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null,
    alertDays: alerts.length,
  };
}

export interface GridResult {
  params: RainRuleParams;
  skill: Skill;
}

export const DEFAULT_GRID = {
  highForecast24hMm: [20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150],
  highCumulative3dMm: [0, 25, 50, 75, 100, 125, 150, 200, 250],
};

/**
 * Score every combination and return them best first: highest CSI, then fewer false alarms,
 * then longer lead time.
 */
export function gridSearch(
  days: DistrictDay[],
  events: TruthEvent[],
  grid = DEFAULT_GRID,
  leadDays = 2,
): GridResult[] {
  const results: GridResult[] = [];
  for (const f of grid.highForecast24hMm) {
    for (const c of grid.highCumulative3dMm) {
      const params = { highForecast24hMm: f, highCumulative3dMm: c };
      results.push({ params, skill: scoreRule(days, events, params, leadDays) });
    }
  }
  return results.sort(
    (a, b) =>
      b.skill.csi - a.skill.csi ||
      a.skill.falseAlarms - b.skill.falseAlarms ||
      (b.skill.meanLeadDays ?? -1) - (a.skill.meanLeadDays ?? -1),
  );
}

/**
 * Build district-days from daily rain series (one per district, consecutive dates).
 * The first 3 and the last day are skipped (no full window).
 */
export function districtDays(
  district: string,
  series: { date: string; rain: number }[],
): DistrictDay[] {
  const out: DistrictDay[] = [];
  for (let i = 3; i < series.length - 1; i++) {
    out.push({
      district,
      date: series[i]!.date,
      rainPrev3d: series[i - 1]!.rain + series[i - 2]!.rain + series[i - 3]!.rain,
      rainNext1d: series[i + 1]!.rain,
    });
  }
  return out;
}

/**
 * Turn per-district daily "flood" flags (e.g. GloFAS flow ≥ 5-year return period at any gauge)
 * into events: each run of consecutive flagged days becomes one event.
 */
export function eventsFromFlags(flags: { district: string; date: string }[]): TruthEvent[] {
  const byDistrict = new Map<string, string[]>();
  for (const f of flags)
    byDistrict.set(f.district, [...(byDistrict.get(f.district) ?? []), f.date]);
  const out: TruthEvent[] = [];
  for (const [district, dates] of byDistrict) {
    const sorted = [...new Set(dates)].sort();
    let start = sorted[0]!;
    let prev = sorted[0]!;
    for (const d of sorted.slice(1)) {
      if (toMs(d) - toMs(prev) > DAY) {
        out.push({ district, start, end: prev });
        start = d;
      }
      prev = d;
    }
    if (sorted.length) out.push({ district, start, end: prev });
  }
  return out;
}
