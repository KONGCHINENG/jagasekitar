// Tiny file cache in worker/.cache. Fresh entries skip the network; stale entries are a fallback
// when the network fails, before falling back further to mock data.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = fileURLToPath(new URL('../../.cache/', import.meta.url));

function pathFor(key: string): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `${CACHE_DIR}${hash}.txt`;
}

export interface CacheHit {
  body: string;
  ageMs: number;
}

export function readCache(key: string): CacheHit | null {
  const file = pathFor(key);
  try {
    const body = readFileSync(file, 'utf8');
    return { body, ageMs: Date.now() - statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

export function writeCache(key: string, body: string): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(pathFor(key), body);
}

/**
 * Return a fresh cached body if younger than `ttlMs`, else fetch and cache. If the fetch fails,
 * return a stale cached body (flagged) rather than throwing; throw only when nothing is cached.
 */
export async function cached(
  key: string,
  ttlMs: number,
  load: () => Promise<string>,
): Promise<{ body: string; from: 'cache' | 'network' | 'stale-cache' }> {
  const hit = readCache(key);
  if (hit && hit.ageMs < ttlMs) return { body: hit.body, from: 'cache' };
  try {
    const body = await load();
    writeCache(key, body);
    return { body, from: 'network' };
  } catch (err) {
    if (hit) return { body: hit.body, from: 'stale-cache' };
    throw err;
  }
}
