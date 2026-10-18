// HTTP with timeout, retry and exponential back-off. Every source goes through here.

export const DEFAULT_USER_AGENT = 'JagaSekitar-Hackathon/1.0';

/** The configured User-Agent, unless it is still the .env.example placeholder (Nominatim 403s it). */
export function userAgent(): string {
  const configured = process.env.NOMINATIM_USER_AGENT?.trim();
  return configured && !/example\.com/i.test(configured) ? configured : DEFAULT_USER_AGENT;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${redactUrl(url)}`);
  }
}

/** Hide API keys in URLs before they reach logs or the admin panel. */
export function redactUrl(url: string): string {
  return url
    .replace(/(\/api\/area\/csv\/)[^/]+/, '$1***')
    .replace(/((?:key|token)=)[^&]+/gi, '$1***');
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 30_000, retries = 2, backoffMs = 2_000, headers = {} } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent(), ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // 4xx (except 429) won't fix itself on retry.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw Object.assign(new HttpError(res.status, url), { noRetry: true });
        }
        throw new HttpError(res.status, url);
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      if ((err as { noRetry?: boolean }).noRetry || attempt === retries) break;
      await sleep(backoffMs * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}
