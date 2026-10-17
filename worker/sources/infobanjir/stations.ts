// Station coordinates: the Infobanjir tables have none. Resolution order per station:
//   admin-set (never overwritten) > JPS alert feed (exact) > Nominatim geocode
//   > JPS grid-cell decode (~5 km) > district centroid.
// Nominatim is called at most NOMINATIM_BUDGET times per run, ≥1.1 s apart, and every query's
// result (including "not found") is cached on disk, so each station is geocoded once.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pointWkt } from '../../src/core/db';
import { DEFAULT_USER_AGENT, HttpError, fetchJson, userAgent } from '../../src/core/http';
import { log } from '../../src/core/log';
import type { SourceContext } from '../../src/core/source';
import { jpsGridCoords } from './parse';

const NOMINATIM_BUDGET = 15;
const MAX_KM_FROM_DISTRICT = 60;
const CACHE_FILE = fileURLToPath(new URL('../../.cache/geocode.json', import.meta.url));
const STATE_NAMES: Record<string, string> = { PRK: 'Perak' };

type LatLon = { lat: number; lon: number };

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bS\.\s*K\.\s*/gi, 'Sekolah Kebangsaan '],
  [/\bS\.\s*M\.\s*K\.\s*/gi, 'Sekolah Menengah Kebangsaan '],
  [/\bSg\.\s*/gi, 'Sungai '],
  [/\bKg\.\s*/gi, 'Kampung '],
  [/\bJln\.\s*/gi, 'Jalan '],
  [/\bJam\.\s*/gi, 'Jambatan '],
  [/\bEmp\.\s*/gi, 'Empangan '],
  [/\bLdg\.\s*/gi, 'Ladang '],
  [/\bTmn\.\s*/gi, 'Taman '],
  [/\bBt\.\s*/gi, 'Batu '],
  [/\bPkn\.\s*/gi, 'Pekan '],
];

/** "Sg. Kerian di Kg. Kebun Baru (F2)" → "Kampung Kebun Baru" (the place, not the river). */
export function geocodeName(stationName: string): string {
  let name = stationName.replace(/\([^)]*\)/g, ' ');
  const at = name.split(/\s+di\s+/i);
  if (at.length > 1) name = at.slice(1).join(' ');
  for (const [re, full] of ABBREVIATIONS) name = name.replace(re, full);
  return name.replace(/\s+/g, ' ').trim();
}

function km(a: LatLon, b: LatLon): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function readGeocodeCache(): Record<string, LatLon | null> {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Record<string, LatLon | null>;
  } catch {
    return {};
  }
}

function writeGeocodeCache(cache: Record<string, LatLon | null>): void {
  mkdirSync(fileURLToPath(new URL('../../.cache/', import.meta.url)), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function resolveStationCoords(ctx: SourceContext): Promise<void> {
  const { data: districts, error: dErr } = await ctx.db
    .from('v_districts_geojson')
    .select('name, centroid_lat, centroid_lon')
    .eq('state', ctx.state);
  if (dErr) throw new Error(`district lookup failed: ${dErr.message}`);
  const centroid = new Map(
    (districts ?? []).map((d) => [
      d.name as string,
      { lat: d.centroid_lat as number, lon: d.centroid_lon as number },
    ]),
  );

  const cache = readGeocodeCache();
  // Nominatim's policy requires a real contact in the User-Agent; it answers 403 to placeholders.
  const contactSet = !/example\.com/i.test(userAgent()) && userAgent() !== DEFAULT_USER_AGENT;
  if (!contactSet && !ctx.useMocks) {
    log.warn(
      'stations',
      'NOMINATIM_USER_AGENT has no real contact; skipping geocoding (using approximate coordinates)',
    );
  }
  let budget = contactSet ? NOMINATIM_BUDGET : 0;
  let updated = 0;
  let calls = 0;

  for (const table of ['rain_stations', 'water_level_stations'] as const) {
    // Stations without coordinates, or with only approximate ones that a geocode could improve.
    const { data: stations, error } = await ctx.db
      .from(table)
      .select('station_id, name, district, coords_source, geom')
      .eq('state', ctx.state)
      .eq('active', true)
      .or('geom.is.null,coords_source.in.(jps_grid,district)');
    if (error) throw new Error(`${table} lookup failed: ${error.message}`);

    for (const s of stations ?? []) {
      const districtCentre = centroid.get(s.district as string);
      const near = (p: LatLon) => !districtCentre || km(p, districtCentre) <= MAX_KM_FROM_DISTRICT;
      const query = `${geocodeName(s.name as string)}, ${s.district ?? ''}, ${STATE_NAMES[ctx.state] ?? ''}, Malaysia`;

      let found: LatLon | null = null;
      let source = '';
      if (query in cache) {
        found = cache[query] ?? null;
      } else if (budget > 0 && !ctx.useMocks) {
        budget--;
        calls++;
        const result = await geocode(query);
        if (result === 'blocked') {
          log.warn('stations', 'Nominatim refused the request (403); no more geocoding this run');
          budget = 0;
        } else if (result !== undefined) {
          cache[query] = result; // network errors (undefined) are retried next run
        }
        found = result && result !== 'blocked' ? result : null;
        await sleep(1100); // Nominatim usage policy: max 1 request per second
      }
      if (found && near(found)) {
        source = 'nominatim';
      } else {
        found = null;
        const grid = jpsGridCoords(s.station_id as string);
        if (grid && near(grid)) {
          found = grid;
          source = 'jps_grid';
        } else if (districtCentre) {
          found = districtCentre;
          source = 'district';
        }
      }
      // Don't rewrite a row that already has this kind of approximate location.
      if (!found || (s.geom && s.coords_source === source)) continue;
      const { error: uErr } = await ctx.db
        .from(table)
        .update({ geom: pointWkt(found.lat, found.lon), coords_source: source })
        .eq('station_id', s.station_id)
        .neq('coords_source', 'admin');
      if (uErr) throw new Error(`${table} coordinate update failed: ${uErr.message}`);
      updated++;
    }
  }
  writeGeocodeCache(cache);
  log.info('stations', `coordinates updated for ${updated} stations (${calls} geocoder calls)`);
}

/**
 * LatLon if found, null if Nominatim has no match, 'blocked' on 403 (policy refusal),
 * undefined if the request failed for another reason.
 */
async function geocode(query: string): Promise<LatLon | null | 'blocked' | undefined> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'my',
  });
  try {
    const res = await fetchJson<{ lat: string; lon: string }[]>(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { timeoutMs: 20_000, retries: 1 },
    );
    const hit = res[0];
    return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) return 'blocked';
    log.warn(
      'stations',
      `geocode failed for "${query}": ${err instanceof Error ? err.message : err}`,
    );
    return undefined;
  }
}
