// Agent tests with a fake OpenAI-compatible API and a fake database (offline, no key needed).
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  aiConfigFromEnv,
  extractJson,
  parseBriefing,
  runBriefingAgent,
  type ToolContext,
} from './agent';
import { mytMidnight } from './index';

const TABLES: Record<string, unknown[]> = {
  districts: [{ name: 'Kerian' }, { name: 'Kinta' }],
  hazard_zones: [
    {
      hazard: 'flood',
      level: 'high',
      district: 'Kerian',
      reason_en: 'Sg. Kurau rising',
      valid_to: '',
    },
  ],
  official_alerts: [],
  v_disease_district_summary: [],
  data_source_status: [{ source: 'firms', enabled: true, last_success_at: null, used_mock: false }],
  admin_broadcasts: [],
};

/** Minimal stand-in for the Supabase query builder: every filter returns itself; await → rows. */
function fakeDb(): SupabaseClient {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'lte', 'gt', 'neq', 'not', 'order', 'limit']) q[m] = () => q;
      q.then = (resolve: (v: unknown) => void) =>
        resolve({ data: TABLES[table] ?? [], error: null });
      return q;
    },
  } as unknown as SupabaseClient;
}

const ctx: ToolContext = {
  db: fakeDb(),
  state: 'PRK',
  stateName: 'PERAK',
  now: new Date('2026-10-21T00:00:00Z'),
};
const cfg = { baseUrl: 'https://ai.test/v1', model: 'test-model', apiKey: 'k', timeoutMs: 5000 };

const goodJson = JSON.stringify({
  summary_en: 'Flood risk is high in Kerian because Sg. Kurau is rising.',
  summary_ms: 'Risiko banjir tinggi di Kerian kerana Sungai Kurau meningkat.',
  suggestions: [
    {
      districts: ['Kerian', 'Atlantis'],
      level: 'high',
      title_en: 'Flood risk high',
      title_ms: 'Risiko banjir tinggi',
      body_en: 'Prepare to move to higher ground.',
      body_ms: 'Bersedia untuk berpindah ke kawasan tinggi.',
      why: 'JPS gauge',
    },
  ],
});

/** Fake chat API that replays the given assistant messages in order and records requests. */
function fakeApi(replies: object[]) {
  const requests: { messages: { role: string }[]; tools?: unknown[] }[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const message = replies[requests.length - 1];
    return new Response(
      JSON.stringify({
        choices: [{ message }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { impl, requests };
}

describe('aiConfigFromEnv', () => {
  it('uses NVIDIA by default and needs a key', () => {
    expect(aiConfigFromEnv({})).toBeNull();
    expect(aiConfigFromEnv({ NVIDIA_API_KEY: 'nvapi-x' })).toMatchObject({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: 'openai/gpt-oss-20b',
      apiKey: 'nvapi-x',
    });
    expect(
      aiConfigFromEnv({ AI_API_KEY: 'k', AI_BASE_URL: 'https://api.deepseek.com/', AI_MODEL: 'm' }),
    ).toMatchObject({ baseUrl: 'https://api.deepseek.com', model: 'm' });
  });
});

describe('output parsing', () => {
  it('finds the JSON inside prose, fences and <think> blocks', () => {
    expect(extractJson('<think>{"no":1}</think>Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('drops districts that do not exist', () => {
    const b = parseBriefing(goodJson, ['Kerian', 'Kinta']);
    expect(b.suggestions[0]!.districts).toEqual(['Kerian']);
  });

  it('rejects an invalid risk level', () => {
    const bad = goodJson.replace('"high"', '"apocalyptic"');
    expect(() => parseBriefing(bad, ['Kerian'])).toThrow();
  });
});

describe('runBriefingAgent', () => {
  it('calls the requested tools, fills in skipped ones, then returns the validated briefing', async () => {
    const api = fakeApi([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'get_active_zones', arguments: '{}' } },
          { id: 'b', type: 'function', function: { name: 'get_districts', arguments: '{}' } },
        ],
      },
      { role: 'assistant', content: goodJson },
      { role: 'assistant', content: goodJson },
    ]);
    const res = await runBriefingAgent(cfg, ctx, api.impl);
    expect(res.toolsUsed.slice(0, 2)).toEqual([
      { tool: 'get_active_zones', rows: 1 },
      { tool: 'get_districts', rows: 2 },
    ]);
    // The four tools the model skipped were fetched and shown to it before the final answer.
    expect(res.toolsUsed.map((t) => t.tool)).toEqual(
      expect.arrayContaining([
        'get_official_alerts',
        'get_data_source_health',
        'get_disease_summary',
        'get_recent_broadcasts',
      ]),
    );
    expect(JSON.stringify(api.requests[2]!.messages.at(-1))).toContain('without checking');
    expect(res.briefing.summary_ms).toContain('Risiko banjir tinggi');
    expect(res.usage.calls).toBe(3);
    // The tool results went back to the model.
    expect(api.requests[1]!.messages.filter((m) => m.role === 'tool')).toHaveLength(2);
    expect(api.requests[0]!.tools?.length).toBeGreaterThanOrEqual(6);
  });

  it('asks once more when the reply is not valid JSON', async () => {
    const api = fakeApi([
      { role: 'assistant', content: 'Sorry, here is a summary in prose.' },
      { role: 'assistant', content: goodJson },
    ]);
    const res = await runBriefingAgent(cfg, ctx, api.impl);
    expect(res.briefing.suggestions).toHaveLength(1);
    expect(api.requests[1]!.messages.at(-1)!.role).toBe('user');
  });

  it('tells the model about an unknown tool instead of crashing', async () => {
    const api = fakeApi([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'x', type: 'function', function: { name: 'delete_everything', arguments: '{}' } },
        ],
      },
      { role: 'assistant', content: goodJson },
      { role: 'assistant', content: goodJson },
    ]);
    const res = await runBriefingAgent(cfg, ctx, api.impl);
    expect(res.toolsUsed[0]).toEqual({ tool: 'delete_everything', rows: 0 });
  });
});

describe('mytMidnight', () => {
  it('is 16:00 UTC the previous day', () => {
    expect(mytMidnight(new Date('2026-10-21T03:00:00Z'))).toBe('2026-10-20T16:00:00.000Z');
    expect(mytMidnight(new Date('2026-10-21T17:00:00Z'))).toBe('2026-10-21T16:00:00.000Z');
  });
});

describe('model quirks', () => {
  it('strips channel markers leaked into tool names', async () => {
    const { toolName } = await import('./agent');
    expect(toolName('get_active_zones<|channel|>commentary')).toBe('get_active_zones');
    expect(toolName(' get_districts ')).toBe('get_districts');
  });
});
