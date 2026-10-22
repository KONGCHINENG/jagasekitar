// A data source adapter: fetch live → normalized records, with a mock fallback, then persist.
// runSource() never throws, so one broken source can't stop the others (Section 9: reliability).
import type { SupabaseClient } from '@supabase/supabase-js';
import { redactUrl } from './http';
import { log } from './log';

export interface SourceContext {
  db: SupabaseClient;
  now: Date;
  state: string; // DEFAULT_STATE, e.g. PRK
  useMocks: boolean;
}

export interface SourceDef<T> {
  /** Matches data_source_status.source */
  name: string;
  fetch(ctx: SourceContext): Promise<T[]>;
  /** Normalized records from mock.json, with times shifted to "now". */
  mock(ctx: SourceContext): T[];
  /** Writes records; returns the number of rows written. */
  persist(records: T[], ctx: SourceContext): Promise<number>;
}

export interface SourceRunResult {
  source: string;
  ok: boolean;
  usedMock: boolean;
  records: number;
  written: number;
  error?: string;
  ms: number;
}

export class MissingConfigError extends Error {}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return redactUrl(msg).slice(0, 500);
}

export async function runSource<T>(
  def: SourceDef<T>,
  ctx: SourceContext,
): Promise<SourceRunResult> {
  const started = Date.now();
  let records: T[] = [];
  let usedMock = false;
  let fetchError: string | undefined;

  if (ctx.useMocks) {
    records = def.mock(ctx);
    usedMock = true;
  } else {
    try {
      records = await def.fetch(ctx);
      if (records.length === 0) throw new Error('source returned no records');
    } catch (err) {
      fetchError = errorMessage(err);
      log.warn(def.name, `live fetch failed, using mock data: ${fetchError}`);
      records = def.mock(ctx);
      usedMock = true;
    }
  }

  let written = 0;
  let persistError: string | undefined;
  try {
    written = await def.persist(records, ctx);
  } catch (err) {
    persistError = errorMessage(err);
    log.error(def.name, `persist failed: ${persistError}`);
  }

  const error = persistError ?? fetchError;
  // A missing API key is a config gap, not an outage: mock data is the intended behaviour.
  const ok = !persistError && (!fetchError || fetchError.startsWith('Missing'));
  await recordStatus(ctx, def.name, {
    ok,
    usedMock,
    error,
    count: records.length,
    sample: records.slice(0, 5),
  });

  const result = {
    source: def.name,
    ok,
    usedMock,
    records: records.length,
    written,
    error,
    ms: Date.now() - started,
  };
  log.info(
    def.name,
    `${ok ? 'ok' : 'FAILED'}${usedMock ? ' (mock)' : ''}: ${records.length} records, ${written} rows written in ${result.ms} ms`,
  );
  return result;
}

async function recordStatus(
  ctx: SourceContext,
  source: string,
  s: { ok: boolean; usedMock: boolean; error?: string; count: number; sample: unknown[] },
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    used_mock: s.usedMock,
    last_record_count: s.count,
    last_payload: s.sample,
  };
  if (s.ok) patch.last_success_at = now;
  if (s.error) {
    patch.last_error_at = now;
    patch.last_error = s.error;
  }
  const { error } = await ctx.db.from('data_source_status').update(patch).eq('source', source);
  if (error) log.error(source, `could not record status: ${error.message}`);
}

/**
 * Shift timestamps so the newest one in the set is "now" (rounded down to 15 min). Mock data
 * then always looks current, so fallback data never shows stale-data banners.
 */
export function rebaseTimes<T>(records: T[], fields: (keyof T)[], now: Date): T[] {
  let max = -Infinity;
  for (const r of records) {
    for (const f of fields) {
      const t = Date.parse(String(r[f] ?? ''));
      if (!Number.isNaN(t)) max = Math.max(max, t);
    }
  }
  if (!Number.isFinite(max)) return records;
  const target = Math.floor(now.getTime() / 900_000) * 900_000;
  const shift = target - max;
  return records.map((r) => {
    const copy = { ...r };
    for (const f of fields) {
      const t = Date.parse(String(r[f] ?? ''));
      if (!Number.isNaN(t)) (copy[f] as unknown) = new Date(t + shift).toISOString();
    }
    return copy;
  });
}
