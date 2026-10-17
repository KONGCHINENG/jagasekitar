// JPS Public Infobanjir adapters: rainfall, river water level and current alerts.
// Polite scraping: descriptive User-Agent, cached responses (refresh ≥ 15 min), back-off on errors.
import { readFileSync } from 'node:fs';
import { cached } from '../../src/core/cache';
import { getSetting, pointWkt, upsertChunks } from '../../src/core/db';
import { fetchText } from '../../src/core/http';
import { rebaseTimes, type SourceContext, type SourceDef } from '../../src/core/source';
import {
  parseCurrentAlerts,
  parseRainfall,
  parseWaterLevel,
  type OfficialAlert,
  type RainReading,
  type WaterLevelReading,
} from './parse';

export type { OfficialAlert, RainReading, WaterLevelReading } from './parse';

const BASE = 'https://publicinfobanjir.water.gov.my';
const TTL_MS = 14 * 60_000; // never hit JPS more than every ~15 min
const FETCH = { timeoutMs: 60_000, retries: 2, backoffMs: 5_000 };

async function get(url: string): Promise<string> {
  const { body } = await cached(url, TTL_MS, () => fetchText(url, FETCH));
  return body;
}

function loadMock<T>(file: string): T[] {
  return JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')) as T[];
}

async function pruneOlderThan(ctx: SourceContext, table: string, key: string): Promise<void> {
  const retention = await getSetting<Record<string, number>>(ctx.db, 'retention_hours', {});
  const hours = retention[key] ?? 168;
  const cutoff = new Date(ctx.now.getTime() - hours * 3600_000).toISOString();
  const { error } = await ctx.db.from(table).delete().lt('observed_at', cutoff);
  if (error) throw new Error(`${table} prune failed: ${error.message}`);
}

/** Once real stations exist for the state, retire the SEED-* placeholders from the seed file. */
async function retireSeedStations(ctx: SourceContext, table: string): Promise<void> {
  const { error } = await ctx.db
    .from(table)
    .update({ active: false })
    .eq('state', ctx.state)
    .like('station_id', 'SEED-%');
  if (error) throw new Error(`${table} seed retirement failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Rainfall
// ---------------------------------------------------------------------------
export const rainSource: SourceDef<RainReading> = {
  name: 'infobanjir_rain',
  async fetch(ctx) {
    const params = new URLSearchParams({
      state: ctx.state,
      district: 'ALL',
      station: 'ALL',
      loginStatus: '0',
      language: '1',
    });
    return parseRainfall(
      await get(`${BASE}/wp-content/themes/shapely/agency/searchresultrainfalldt1.php?${params}`),
    );
  },
  mock: (ctx) =>
    rebaseTimes(loadMock<RainReading>('mock-rain.json'), ['observedAt'], ctx.now).map((r) => ({
      ...r,
      mock: true,
    })),
  async persist(records, ctx) {
    await upsertChunks(
      ctx.db,
      'rain_stations',
      records.map((r) => ({
        station_id: r.stationId,
        name: r.name,
        state: ctx.state,
        district: r.district,
        active: true,
      })),
      'station_id',
    );
    const written = await upsertChunks(
      ctx.db,
      'rain_readings',
      records.map((r) => ({
        station_id: r.stationId,
        observed_at: r.observedAt,
        rain_1h: r.rain1h,
        rain_3h: r.rain3h,
        rain_6h: r.rain6h,
        rain_24h: r.rain24h,
        rain_72h: r.rain72h,
        rain_since_midnight: r.rainSinceMidnight,
        rain_day_minus_1: r.daily[0]?.mm ?? null,
        rain_day_minus_2: r.daily[1]?.mm ?? null,
        rain_day_minus_3: r.daily[2]?.mm ?? null,
        rain_day_minus_4: r.daily[3]?.mm ?? null,
        rain_day_minus_5: r.daily[4]?.mm ?? null,
        raw: { daily: r.daily, mock: r.mock ?? false },
      })),
      'station_id,observed_at',
    );
    await retireSeedStations(ctx, 'rain_stations');
    await pruneOlderThan(ctx, 'rain_readings', 'rain_readings');
    return written;
  },
};

// ---------------------------------------------------------------------------
// Water level
// ---------------------------------------------------------------------------
/** rising / falling / steady versus the station's previous reading (±2 cm dead band). */
export function trendFor(
  current: number,
  previous: number | undefined,
): 'rising' | 'falling' | 'steady' {
  if (previous == null) return 'steady';
  const diff = current - previous;
  return diff > 0.02 ? 'rising' : diff < -0.02 ? 'falling' : 'steady';
}

export const waterLevelSource: SourceDef<WaterLevelReading> = {
  name: 'infobanjir_water_level',
  async fetch(ctx) {
    // Note: adding type=NEGERI (as the site's own state links do) makes this endpoint return "No Data".
    const params = new URLSearchParams({
      state: ctx.state,
      district: 'ALL',
      station: 'ALL',
      lang: 'en',
    });
    return parseWaterLevel(
      await get(`${BASE}/index.php/aras-air/data-paras-air/aras-air-data/?${params}`),
    );
  },
  mock: (ctx) =>
    rebaseTimes(loadMock<WaterLevelReading>('mock-water-level.json'), ['observedAt'], ctx.now).map(
      (r) => ({
        ...r,
        mock: true,
      }),
    ),
  async persist(records, ctx) {
    await upsertChunks(
      ctx.db,
      'water_level_stations',
      records.map((r) => ({
        station_id: r.stationId,
        name: r.name,
        river: r.river,
        basin: r.basin,
        state: ctx.state,
        district: r.district,
        normal_level: r.normal,
        alert_level: r.alert,
        warning_level: r.warning,
        danger_level: r.danger,
        active: true,
      })),
      'station_id',
    );

    // Previous readings (last 24 h) for the trend.
    const since = new Date(ctx.now.getTime() - 24 * 3600_000).toISOString();
    const { data: prev, error } = await ctx.db
      .from('water_level_readings')
      .select('station_id, observed_at, level')
      .in(
        'station_id',
        records.map((r) => r.stationId),
      )
      .gte('observed_at', since)
      .order('observed_at', { ascending: false });
    if (error) throw new Error(`water_level_readings lookup failed: ${error.message}`);
    const previousLevel = (r: WaterLevelReading) =>
      (prev ?? []).find(
        (p) => p.station_id === r.stationId && Date.parse(p.observed_at) < Date.parse(r.observedAt),
      )?.level as number | undefined;

    const written = await upsertChunks(
      ctx.db,
      'water_level_readings',
      records.map((r) => ({
        station_id: r.stationId,
        observed_at: r.observedAt,
        level: r.level,
        status: r.status,
        trend: trendFor(r.level, previousLevel(r)),
        raw: {
          normal: r.normal,
          alert: r.alert,
          warning: r.warning,
          danger: r.danger,
          mock: r.mock ?? false,
        },
      })),
      'station_id,observed_at',
    );
    await retireSeedStations(ctx, 'water_level_stations');
    await pruneOlderThan(ctx, 'water_level_readings', 'water_level_readings');
    return written;
  },
};

// ---------------------------------------------------------------------------
// Current official alerts (all states)
// ---------------------------------------------------------------------------
export const alertsSource: SourceDef<OfficialAlert> = {
  name: 'infobanjir_alerts',
  async fetch() {
    // The page loads this JSON itself; a cache-busting ?v= isn't needed thanks to our TTL.
    return parseCurrentAlerts(
      await get(`${BASE}/wp-content/themes/enlighten/data/currentalert.json`),
    );
  },
  mock: (ctx) => rebaseTimes(loadMock<OfficialAlert>('mock-alerts.json'), ['issuedAt'], ctx.now),
  async persist(records, ctx) {
    // The feed is a snapshot of what's active now: replace the previous snapshot.
    const { error: delError } = await ctx.db.from('official_alerts').delete().eq('source', 'jps');
    if (delError) throw new Error(`official_alerts cleanup failed: ${delError.message}`);
    const expires = new Date(ctx.now.getTime() + 3 * 3600_000).toISOString();
    if (records.length) {
      const { error } = await ctx.db.from('official_alerts').insert(
        records.map((a) => ({
          source: 'jps',
          station_id: a.stationId,
          state: a.state,
          district: a.district,
          title: a.title,
          level: a.level,
          issued_at: a.issuedAt,
          expires_at: expires,
          raw: a,
        })),
      );
      if (error) throw new Error(`official_alerts insert failed: ${error.message}`);
    }

    // The alert feed has exact coordinates: use them for matching stations (unless an admin set them).
    for (const a of records) {
      if (a.lat == null || a.lon == null) continue;
      for (const table of ['rain_stations', 'water_level_stations']) {
        const { error } = await ctx.db
          .from(table)
          .update({ geom: pointWkt(a.lat, a.lon), coords_source: 'jps' })
          .eq('station_id', a.stationId)
          .neq('coords_source', 'admin');
        if (error) throw new Error(`${table} coordinate update failed: ${error.message}`);
      }
    }
    return records.length;
  },
};
