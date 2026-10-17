import 'server-only';
// Expo Push API (same contract as the worker's client): batches of 100, dead-token detection.
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
  unregistered: boolean;
}

export async function sendPush(messages: PushMessage[]): Promise<PushResult[]> {
  const out: PushResult[] = [];
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(
          batch.map((m) => ({ ...m, sound: 'default', priority: 'high', channelId: 'alerts' })),
        ),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
      const { data } = (await res.json()) as {
        data: { status: string; details?: { error?: string } }[];
      };
      data.forEach((t, k) =>
        out.push({
          token: batch[k]!.to,
          ok: t.status === 'ok',
          unregistered: t.details?.error === 'DeviceNotRegistered',
        }),
      );
    } catch {
      for (const m of batch) out.push({ token: m.to, ok: false, unregistered: false });
    }
  }
  return out;
}
