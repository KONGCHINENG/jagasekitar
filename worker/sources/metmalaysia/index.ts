// MetMalaysia weather warnings via data.gov.my (no key). Rain and thunderstorm warnings for the
// default state are stored in official_alerts (source 'metmalaysia'), one row per district, and
// the flood engine draws each as a district-wide zone until the warning expires.
import { MALAYSIA_STATES } from '@jagasekitar/shared';
import { cached } from '../../src/core/cache';
import { fetchText } from '../../src/core/http';
import type { SourceContext, SourceDef } from '../../src/core/source';
import { parseWarnings, type MetWarning } from './parse';

export type { MetWarning } from './parse';

// The trailing slash matters: without it the API answers with a redirect.
const URL_WARNINGS = 'https://api.data.gov.my/weather/warning/?limit=100';
const TTL_MS = 10 * 60_000;

/** Stands in for "the feed answered and nothing is active", so the run isn't counted as a failure. */
const NOTHING_ACTIVE: MetWarning = {
  kind: 'other',
  level: 'none',
  titleEn: 'No active warnings',
  titleMs: 'Tiada amaran aktif',
  issuedAt: new Date(0).toISOString(),
  validFrom: new Date(0).toISOString(),
  validTo: new Date(0).toISOString(),
  districts: [],
  textEn: '',
};

async function stateDistricts(ctx: SourceContext): Promise<string[]> {
  const { data, error } = await ctx.db.from('districts').select('name').eq('state', ctx.state);
  if (error) throw new Error(`districts: ${error.message}`);
  return (data ?? []).map((d) => d.name as string);
}

export const metMalaysiaSource: SourceDef<MetWarning> = {
  name: 'metmalaysia',
  async fetch(ctx) {
    const state = MALAYSIA_STATES[ctx.state as keyof typeof MALAYSIA_STATES];
    if (!state) throw new Error(`MetMalaysia: unknown state ${ctx.state}`);
    const { body } = await cached(URL_WARNINGS, TTL_MS, () =>
      fetchText(URL_WARNINGS, { timeoutMs: 30_000, retries: 2 }),
    );
    const warnings = parseWarnings(body, state, await stateDistricts(ctx));
    return warnings.length ? warnings : [NOTHING_ACTIVE];
  },
  // No mock warnings: inventing an official warning would be worse than showing none.
  mock: () => [],
  async persist(records, ctx) {
    // The feed is a snapshot of what is active: replace the previous snapshot.
    const { error: delError } = await ctx.db
      .from('official_alerts')
      .delete()
      .eq('source', 'metmalaysia');
    if (delError) throw new Error(`official_alerts cleanup failed: ${delError.message}`);
    const now = ctx.now.getTime();
    // Same convention as the JPS rows (e.g. 'PERAK'), so the app lists both together.
    const stateName = (
      MALAYSIA_STATES[ctx.state as keyof typeof MALAYSIA_STATES] ?? ctx.state
    ).toUpperCase();
    const rows = records
      .filter((w) => w.level !== 'none' && w.districts.length && Date.parse(w.validTo) > now)
      .flatMap((w) =>
        w.districts.map((district) => ({
          source: 'metmalaysia',
          station_id: null,
          state: stateName,
          district,
          title: w.titleEn,
          level: w.level,
          issued_at: w.issuedAt,
          expires_at: w.validTo,
          raw: { kind: w.kind, title_ms: w.titleMs, valid_from: w.validFrom, text_en: w.textEn },
        })),
      );
    if (rows.length) {
      const { error } = await ctx.db.from('official_alerts').insert(rows);
      if (error) throw new Error(`official_alerts insert failed: ${error.message}`);
    }
    return rows.length;
  },
};
