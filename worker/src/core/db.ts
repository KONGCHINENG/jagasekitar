import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the root .env');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Upsert in chunks so large batches (e.g. 28k weather rows) stay under request limits. */
export async function upsertChunks(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  opts: { chunkSize?: number; ignoreDuplicates?: boolean } = {},
): Promise<number> {
  const { chunkSize = 1000, ignoreDuplicates = false } = opts;
  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await db.from(table).upsert(chunk, { onConflict, ignoreDuplicates });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

/** PostGIS point as EWKT, which PostgREST accepts for geography columns. */
export function pointWkt(lat: number, lon: number): string {
  return `SRID=4326;POINT(${lon} ${lat})`;
}

export async function getSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error || !data) return fallback;
  return { ...fallback, ...(data.value as object) } as T;
}
