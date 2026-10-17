// NASA FIRMS fire hotspots over Sumatra, Kalimantan, Peninsular Malaysia and Borneo.
// Pulls VIIRS (S-NPP, NOAA-20) and MODIS near-real-time products for the last 2 days.
import { HAZE_BBOX } from '@jagasekitar/shared';
import { readFileSync } from 'node:fs';
import { cached } from '../../src/core/cache';
import { upsertChunks } from '../../src/core/db';
import { fetchText } from '../../src/core/http';
import { log } from '../../src/core/log';
import { MissingConfigError, rebaseTimes, type SourceDef } from '../../src/core/source';
import { parseFirmsCsv, type FireHotspot } from './parse';

export type { FireHotspot } from './parse';

const PRODUCTS = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'] as const;
const DAYS = 2;
const CACHE_TTL_MS = 90 * 60_000;

export async function fetchHotspots(): Promise<FireHotspot[]> {
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) throw new MissingConfigError('Missing FIRMS_MAP_KEY (using mock hotspots)');
  const bbox = HAZE_BBOX.join(',');
  const all: FireHotspot[] = [];
  const failures: string[] = [];
  for (const product of PRODUCTS) {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${product}/${bbox}/${DAYS}`;
    try {
      const { body, from } = await cached(`firms:${product}:${bbox}:${DAYS}`, CACHE_TTL_MS, () =>
        fetchText(url, { timeoutMs: 60_000 }),
      );
      const rows = parseFirmsCsv(body, product);
      if (from === 'stale-cache')
        log.warn('firms', `${product}: network failed, using stale cache`);
      all.push(...rows);
    } catch (err) {
      failures.push(`${product}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Partial data is still useful; only fail when every product failed.
  if (failures.length === PRODUCTS.length) throw new Error(failures.join('; '));
  if (failures.length) log.warn('firms', `partial: ${failures.join('; ')}`);
  return all;
}

export const firmsSource: SourceDef<FireHotspot> = {
  name: 'firms',
  fetch: fetchHotspots,
  mock(ctx) {
    const raw = JSON.parse(
      readFileSync(new URL('./mock.json', import.meta.url), 'utf8'),
    ) as FireHotspot[];
    return rebaseTimes(raw, ['acquiredAt'], ctx.now).map((r) => ({ ...r, source: 'mock' }));
  },
  async persist(records, ctx) {
    // Mock rows get new timestamps every run, so replace them instead of accumulating; live data
    // clears them too so the haze engine never mixes mock and real fires.
    const { error } = await ctx.db.from('fire_hotspots').delete().eq('source', 'mock');
    if (error) throw new Error(`fire_hotspots mock cleanup failed: ${error.message}`);

    const rows = records.map((r) => ({
      source: r.source,
      lat: r.lat,
      lon: r.lon,
      brightness: r.brightness,
      frp: r.frp,
      confidence: r.confidence,
      acquired_at: r.acquiredAt,
    }));
    return upsertChunks(ctx.db, 'fire_hotspots', rows, 'source,lat,lon,acquired_at', {
      ignoreDuplicates: true,
    });
  },
};
