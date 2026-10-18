// Measured air quality from WAQI (free token: https://aqicn.org/data-platform/token/), which
// republishes Malaysia's DOE stations. Without WAQI_TOKEN the haze map shows labelled mock
// readings. Data terms: free for non-commercial use with attribution to WAQI and the DOE.
import { readFileSync } from 'node:fs';
import { cached } from '../../src/core/cache';
import { pointWkt, upsertChunks } from '../../src/core/db';
import { fetchText } from '../../src/core/http';
import { MissingConfigError, rebaseTimes, type SourceDef } from '../../src/core/source';
import { parseBounds, parseFeed, type AirQualityObs } from './parse';

export type { AirQualityObs } from './parse';

const BASE = 'https://api.waqi.info';
// Perak plus a margin (Penang, north Selangor): nearby stations still help at the state edges.
const BOX = { south: 3.3, west: 99.9, north: 6.2, east: 102.0 };
const MAX_STATIONS = 30;
const TTL_MS = 45 * 60_000; // DOE readings are hourly

export const waqiSource: SourceDef<AirQualityObs> = {
  name: 'waqi',
  async fetch() {
    const token = process.env.WAQI_TOKEN?.trim();
    if (!token) throw new MissingConfigError('Missing WAQI_TOKEN (using mock air quality)');
    const get = (url: string) =>
      cached(url.replace(token, 'TOKEN'), TTL_MS, () =>
        fetchText(url, { timeoutMs: 30_000, retries: 2 }),
      ).then((r) => r.body);

    const bounds = parseBounds(
      await get(
        `${BASE}/v2/map/bounds?latlng=${BOX.south},${BOX.west},${BOX.north},${BOX.east}&networks=all&token=${token}`,
      ),
    ).slice(0, MAX_STATIONS);
    const out: AirQualityObs[] = [];
    for (const s of bounds) {
      try {
        out.push(parseFeed(await get(`${BASE}/feed/@${s.uid}/?token=${token}`), s));
      } catch {
        // One bad station shouldn't drop the rest.
      }
    }
    return out;
  },
  mock(ctx) {
    const raw = JSON.parse(
      readFileSync(new URL('./mock.json', import.meta.url), 'utf8'),
    ) as AirQualityObs[];
    return rebaseTimes(raw, ['observedAt'], ctx.now);
  },
  async persist(records, ctx) {
    // Live and mock readings never mix on the map.
    const other = records.some((r) => r.source === 'mock') ? 'waqi' : 'mock';
    const { error } = await ctx.db.from('air_quality_obs').delete().eq('source', other);
    if (error) throw new Error(`air_quality_obs cleanup failed: ${error.message}`);
    const rows = records.map((r) => ({
      uid: r.uid,
      source: r.source,
      name: r.name,
      geom: pointWkt(r.lat, r.lon),
      pm25: r.pm25,
      aqi: r.aqi,
      observed_at: r.observedAt,
      updated_at: ctx.now.toISOString(),
    }));
    return upsertChunks(ctx.db, 'air_quality_obs', rows, 'uid');
  },
};
