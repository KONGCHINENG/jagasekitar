// Flood calibration: replay past years through the flood rain rule, score it against real past
// floods (Admin → Calibration → events) and GloFAS 5-year river flow, and save the results with
// suggested thresholds for an admin to review and apply.
//
// Run:  npm run calibrate -w @jagasekitar/worker
//   or  cd worker && npx tsx scripts/calibrate.ts --from=2014-01-01 --include-drafts
//
// Data (free, no key): ERA5 daily rain at each district centre (Open-Meteo archive) and GloFAS
// daily river flow at each JPS gauge (Open-Meteo Flood API). Both are cached in worker/.cache.
import {
  DEFAULT_FLOOD,
  districtDays,
  eventsFromFlags,
  fromSettings,
  gridSearch,
  scoreRule,
  type DistrictDay,
  type Skill,
  type TruthEvent,
} from '@jagasekitar/engine';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { cached } from '../src/core/cache';
import { createServiceClient } from '../src/core/db';
import { fetchText } from '../src/core/http';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const INCLUDE_DRAFTS = args.includes('--include-drafts');
const STATE = process.env.DEFAULT_STATE?.trim() || 'PRK';
const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const FROM = arg('from') ?? '2014-01-01';
// ERA5 reaches the archive about 5 days late.
const TO = arg('to') ?? isoDay(Date.now() - 7 * DAY);
const MONTH_MS = 30 * DAY;

const db = createServiceClient();

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

/** ERA5 daily rain per district centre. */
async function districtRain(districts: { name: string; lat: number; lon: number }[]) {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${districts.map((d) => d.lat.toFixed(3)).join(',')}` +
    `&longitude=${districts.map((d) => d.lon.toFixed(3)).join(',')}` +
    `&start_date=${FROM}&end_date=${TO}&daily=precipitation_sum&timezone=Asia%2FKuala_Lumpur`;
  const { body } = await cached(`calibrate:${url}`, MONTH_MS, () =>
    fetchText(url, { timeoutMs: 180_000, retries: 2 }),
  );
  const raw = JSON.parse(body) as unknown;
  const points = (Array.isArray(raw) ? raw : [raw]) as {
    daily?: { time: string[]; precipitation_sum: (number | null)[] };
  }[];
  return districts.map((d, i) => {
    const daily = points[i]?.daily;
    if (!daily) throw new Error(`No ERA5 rain for ${d.name}`);
    return {
      district: d.name,
      series: daily.time.map((date, k) => ({ date, rain: daily.precipitation_sum[k] ?? 0 })),
    };
  });
}

/** GloFAS daily flow per gauge; returns the days a district had any gauge at ≥ its 5-year flow. */
async function glofasFloodDays(
  gauges: { station_id: string; district: string; lat: number; lon: number; rp5: number }[],
) {
  const flags: { district: string; date: string }[] = [];
  for (let i = 0; i < gauges.length; i += 50) {
    const batch = gauges.slice(i, i + 50);
    const url =
      `https://flood-api.open-meteo.com/v1/flood?latitude=${batch.map((g) => g.lat.toFixed(4)).join(',')}` +
      `&longitude=${batch.map((g) => g.lon.toFixed(4)).join(',')}` +
      `&daily=river_discharge&start_date=${FROM}&end_date=${TO}`;
    const { body } = await cached(`calibrate:${url}`, MONTH_MS, () =>
      fetchText(url, { timeoutMs: 180_000, retries: 2 }),
    );
    const raw = JSON.parse(body) as unknown;
    const points = (Array.isArray(raw) ? raw : [raw]) as {
      daily?: { time: string[]; river_discharge: (number | null)[] };
    }[];
    batch.forEach((g, k) => {
      const daily = points[k]?.daily;
      daily?.time.forEach((date, j) => {
        const q = daily.river_discharge[j];
        if (q != null && q >= g.rp5) flags.push({ district: g.district, date });
      });
    });
  }
  return flags;
}

const round = (s: Skill) => ({
  ...s,
  csi: +s.csi.toFixed(3),
  pod: +s.pod.toFixed(3),
  far: +s.far.toFixed(3),
  meanLeadDays: s.meanLeadDays == null ? null : +s.meanLeadDays.toFixed(1),
});

async function main() {
  console.log(
    `Flood calibration ${FROM} → ${TO} (${STATE})${INCLUDE_DRAFTS ? ', drafts included' : ''}`,
  );

  const [districtRows, gaugeRows, flowRows, eventRows, setting] = await Promise.all([
    must<{ name: string; centroid_lat: number; centroid_lon: number }[]>(
      db.from('v_districts_geojson').select('name, centroid_lat, centroid_lon').eq('state', STATE),
    ),
    must<{ station_id: string; district: string | null; lat: number | null; lon: number | null }[]>(
      db
        .from('v_water_stations_latest')
        .select('station_id, district, lat, lon')
        .eq('state', STATE),
    ),
    must<{ station_id: string; rp5: number | null }[]>(
      db.from('river_flow_forecasts').select('station_id, rp5'),
    ),
    must<{ district: string; start_date: string; end_date: string; verified: boolean }[]>(
      db
        .from('flood_events')
        .select('district, start_date, end_date, verified')
        .eq('state', STATE)
        .gte('end_date', FROM)
        .lte('start_date', TO),
    ),
    must<{ value: unknown }>(db.from('settings').select('value').eq('key', 'flood').single()),
  ]);

  const flood = fromSettings(DEFAULT_FLOOD, setting.value);
  const current = {
    highForecast24hMm: flood.highForecast24hMm,
    highCumulative3dMm: flood.highCumulative3dMm,
  };
  const districts = districtRows.map((d) => ({
    name: d.name,
    lat: d.centroid_lat,
    lon: d.centroid_lon,
  }));
  const known = new Set(districts.map((d) => d.name));
  const events: TruthEvent[] = eventRows
    .filter((e) => (INCLUDE_DRAFTS || e.verified) && known.has(e.district))
    .map((e) => ({ district: e.district, start: e.start_date, end: e.end_date }));
  console.log(
    `${events.length} events used (${eventRows.filter((e) => e.verified).length} verified of ${eventRows.length} in the period)`,
  );

  console.log('Fetching ERA5 daily rain (cached after the first run)…');
  const rain = await districtRain(districts);
  const days: DistrictDay[] = rain.flatMap((r) => districtDays(r.district, r.series));

  const rp5 = new Map(flowRows.filter((r) => r.rp5).map((r) => [r.station_id, r.rp5!]));
  const gauges = gaugeRows
    .filter((g) => g.district && g.lat != null && g.lon != null && rp5.has(g.station_id))
    .map((g) => ({
      station_id: g.station_id,
      district: g.district!,
      lat: g.lat!,
      lon: g.lon!,
      rp5: rp5.get(g.station_id)!,
    }));
  console.log(
    `Fetching GloFAS daily flow for ${gauges.length} gauges (cached after the first run)…`,
  );
  const glofasEvents = eventsFromFlags(await glofasFloodDays(gauges));

  // Real events decide the suggestion; GloFAS is a second, automatic check.
  const grid = events.length ? gridSearch(days, events) : [];
  const best = grid[0];
  const currentSkill = scoreRule(days, events, current);
  const glofasGrid = gridSearch(days, glofasEvents);
  const result = {
    hazard: 'flood',
    period_from: FROM,
    period_to: TO,
    events_used: events.length,
    district_days: days.length,
    current: { params: current, metrics: round(currentSkill) },
    suggested: best
      ? { params: best.params, metrics: round(best.skill) }
      : { params: current, metrics: round(currentSkill) },
    details: {
      include_drafts: INCLUDE_DRAFTS,
      top: grid.slice(0, 10).map((g) => ({ params: g.params, metrics: round(g.skill) })),
      glofas_truth: {
        events: glofasEvents.length,
        current: round(scoreRule(days, glofasEvents, current)),
        best: glofasGrid[0]
          ? { params: glofasGrid[0].params, metrics: round(glofasGrid[0].skill) }
          : null,
        suggested_on_glofas: best ? round(scoreRule(days, glofasEvents, best.params)) : null,
      },
      caveats: [
        'ERA5 rain is a ~25 km grid average: storms look weaker than at a JPS gauge.',
        "The next day's actual rain stands in for the forecast (perfect forecast), so real skill is lower.",
        'Only the forecast rain rule is tuned; JPS gauge rules cannot be replayed (no public history).',
        'One point per district (its centre); large districts may miss local storms.',
      ],
    },
  };

  const inserted = await must<{ id: string }>(
    db.from('calibration_runs').insert(result).select('id').single(),
  );

  console.table([
    { set: 'current', ...current, ...round(currentSkill) },
    ...(best ? [{ set: 'suggested', ...best.params, ...round(best.skill) }] : []),
  ]);
  console.log(
    `GloFAS check: ${glofasEvents.length} high-flow episodes; current CSI ${round(scoreRule(days, glofasEvents, current)).csi}` +
      (best ? `, suggested CSI ${round(scoreRule(days, glofasEvents, best.params)).csi}` : ''),
  );
  if (!events.length)
    console.log(
      'No verified events yet: verify them in Admin → Calibration, or use --include-drafts.',
    );
  console.log(`Saved run ${inserted.id}. Review it in Admin → Calibration.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
