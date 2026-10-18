// GloFAS river discharge forecasts via the Open-Meteo Flood API (no key), one point per JPS river
// gauge in the default state. Written to river_flow_forecasts; the flood engine turns forecast flow
// above a river's 2/5/20-year return period into risk days before the gauge itself reacts.
import { readFileSync } from 'node:fs';
import { cached } from '../../src/core/cache';
import { upsertChunks } from '../../src/core/db';
import { fetchText } from '../../src/core/http';
import type { SourceContext, SourceDef } from '../../src/core/source';
import { parseReturnPeriods, parseRiverFlow, type RiverFlow } from './parse';

export type { RiverFlow } from './parse';

const BASE = 'https://flood-api.open-meteo.com/v1/flood';
const POINTS_PER_REQUEST = 50;
const PAST_DAYS = 92;
const FORECAST_DAYS = 7;
const TTL_MS = 3 * 3600_000; // GloFAS updates daily
// Return periods come from the reanalysis record; they barely move, so refetch monthly.
const HISTORY = { start: '1995-01-01', end: '2024-12-31', ttlMs: 30 * 86_400_000 };

async function gauges(ctx: SourceContext) {
  const { data, error } = await ctx.db
    .from('v_water_stations_latest')
    .select('station_id, lat, lon')
    .eq('state', ctx.state)
    .not('lat', 'is', null);
  if (error) throw new Error(`water stations: ${error.message}`);
  return (data ?? []) as { station_id: string; lat: number; lon: number }[];
}

export const glofasSource: SourceDef<RiverFlow> = {
  name: 'glofas',
  async fetch(ctx) {
    const stations = await gauges(ctx);
    const today = ctx.now.toISOString().slice(0, 10);
    const out: RiverFlow[] = [];
    for (let i = 0; i < stations.length; i += POINTS_PER_REQUEST) {
      const batch = stations.slice(i, i + POINTS_PER_REQUEST);
      const where =
        `latitude=${batch.map((s) => s.lat.toFixed(4)).join(',')}` +
        `&longitude=${batch.map((s) => s.lon.toFixed(4)).join(',')}&daily=river_discharge`;
      const forecastUrl = `${BASE}?${where}&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}`;
      const historyUrl = `${BASE}?${where}&start_date=${HISTORY.start}&end_date=${HISTORY.end}`;
      const [forecast, history] = await Promise.all([
        cached(`glofas:${forecastUrl}`, TTL_MS, () =>
          fetchText(forecastUrl, { timeoutMs: 60_000, retries: 2 }),
        ),
        cached(`glofas:${historyUrl}`, HISTORY.ttlMs, () =>
          fetchText(historyUrl, { timeoutMs: 120_000, retries: 2 }),
        ),
      ]);
      const returnPeriods = parseReturnPeriods(history.body, batch.length);
      out.push(
        ...parseRiverFlow(
          forecast.body,
          batch.map((s) => s.station_id),
          today,
          3,
          returnPeriods,
        ),
      );
    }
    return out;
  },
  mock(ctx) {
    // Ordinary flows (ratio ≈ 1) for a few real gauges, so a failure never invents a flood.
    const raw = JSON.parse(
      readFileSync(new URL('./mock.json', import.meta.url), 'utf8'),
    ) as RiverFlow[];
    const today = ctx.now.toISOString().slice(0, 10);
    return raw.map((r) => ({ ...r, peakDate: today }));
  },
  async persist(records, ctx) {
    const rows = records.map((r) => ({
      station_id: r.stationId,
      cell_lat: r.cellLat,
      cell_lon: r.cellLon,
      baseline_median: r.baselineMedian,
      peak: r.peak,
      peak_date: r.peakDate,
      ratio: r.ratio,
      rp2: r.returnPeriods?.rp2 ?? null,
      rp5: r.returnPeriods?.rp5 ?? null,
      rp20: r.returnPeriods?.rp20 ?? null,
      record_years: r.returnPeriods?.years ?? null,
      exceeded: r.exceeded,
      series: r.series,
      fetched_at: ctx.now.toISOString(),
      updated_at: ctx.now.toISOString(),
    }));
    return upsertChunks(ctx.db, 'river_flow_forecasts', rows, 'station_id');
  },
};
