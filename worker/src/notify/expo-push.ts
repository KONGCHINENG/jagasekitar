// Expo Push API client: batches of 100, per-message tickets, dead-token detection.
const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface PushResult {
  token: string;
  ok: boolean;
  /** The token is dead (app uninstalled / permissions revoked): remove it. */
  unregistered: boolean;
  error?: string;
}

interface Ticket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export async function sendPush(messages: PushMessage[], batchSize = 100): Promise<PushResult[]> {
  const results: PushResult[] = [];
  const token = process.env.EXPO_ACCESS_TOKEN?.trim();
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const payload = batch.map((m) => ({
      ...m,
      sound: 'default',
      priority: 'high',
      channelId: 'alerts',
    }));
    try {
      const res = await postJson(payload, token);
      res.forEach((t, k) => {
        const to = batch[k]!.to;
        results.push({
          token: to,
          ok: t.status === 'ok',
          unregistered: t.details?.error === 'DeviceNotRegistered',
          error: t.status === 'error' ? (t.details?.error ?? t.message) : undefined,
        });
      });
    } catch (err) {
      for (const m of batch) {
        results.push({
          token: m.to,
          ok: false,
          unregistered: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return results;
}

/** POST with 3 attempts and exponential back-off. */
async function postJson(payload: unknown[], accessToken: string | undefined): Promise<Ticket[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
      const json = (await res.json()) as { data: Ticket[] };
      return json.data;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}
