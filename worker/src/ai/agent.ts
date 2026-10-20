// AI briefing agent. An LLM (any OpenAI-compatible API; NVIDIA by default) reads the current
// situation through read-only tools and drafts a summary in English and Bahasa Melayu plus
// suggested broadcasts. It never writes to the database or sends anything: an admin reviews the
// draft in Admin → AI briefing and sends through the normal Broadcast page.
//
// Privacy: tools return zone, station and district-level data only — never user locations,
// devices, emails or individual case reports.
import { RISK_LEVELS, type RiskLevel } from '@jagasekitar/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

/** From the environment: AI_BASE_URL / AI_MODEL / AI_API_KEY (or NVIDIA_API_KEY). */
export function aiConfigFromEnv(env = process.env): AiConfig | null {
  const apiKey = (env.AI_API_KEY || env.NVIDIA_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    baseUrl: (env.AI_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
    model: env.AI_MODEL || 'openai/gpt-oss-20b',
    apiKey,
    timeoutMs: 180_000,
  };
}

// ---------------------------------------------------------------------------
// Tools (read-only)
// ---------------------------------------------------------------------------
export interface ToolContext {
  db: SupabaseClient;
  state: string; // e.g. PRK
  stateName: string; // e.g. PERAK (official_alerts convention)
  now: Date;
}

type ToolFn = (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown[]>;

async function rows<T>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data ?? [];
}

const TOOLS: Record<string, { description: string; run: ToolFn }> = {
  get_districts: {
    description: 'Names of the districts in the state. Use these exact names in suggestions.',
    run: async (ctx) =>
      (await rows(ctx.db.from('districts').select('name').eq('state', ctx.state))).map(
        (d) => (d as { name: string }).name,
      ),
  },
  get_active_zones: {
    description:
      'Hazard zones (haze, flood, disease) valid right now, with risk level, district and the reason. These are model predictions (risk), not confirmed events.',
    run: async (ctx) => {
      const now = ctx.now.toISOString();
      const data = await rows(
        ctx.db
          .from('hazard_zones')
          .select('hazard, level, district, reason_en, valid_to')
          .lte('valid_from', now)
          .gt('valid_to', now)
          .neq('level', 'none')
          .order('level', { ascending: false })
          .limit(60),
      );
      return data;
    },
  },
  get_official_alerts: {
    description:
      'Official alerts in force: JPS river/rain alerts and MetMalaysia weather warnings.',
    run: async (ctx) =>
      rows(
        ctx.db
          .from('official_alerts')
          .select('source, district, title, level, issued_at, expires_at')
          .eq('state', ctx.stateName)
          .gt('expires_at', ctx.now.toISOString())
          .limit(40),
      ),
  },
  get_disease_summary: {
    description:
      'Disease cases reported by hospitals and clinics in the last 7 days per district (aggregate counts only), with the usual weekly rate.',
    run: async (ctx) =>
      rows(
        ctx.db
          .from('v_disease_district_summary')
          .select('district, disease_name_en, cases_7d, baseline_7d, per_100k')
          .eq('state', ctx.state)
          .gt('cases_7d', 0)
          .limit(40),
      ),
  },
  get_data_source_health: {
    description:
      'When each data source last updated successfully, so the briefing can say if data is stale.',
    run: async (ctx) => {
      const data = await rows(
        ctx.db.from('data_source_status').select('source, enabled, last_success_at, used_mock'),
      );
      return (data as { last_success_at: string | null }[]).map((s) => ({
        ...s,
        minutes_since_success: s.last_success_at
          ? Math.round((ctx.now.getTime() - Date.parse(s.last_success_at)) / 60_000)
          : null,
      }));
    },
  },
  get_recent_broadcasts: {
    description:
      'Broadcasts admins already sent in the last 48 hours (avoid suggesting duplicates).',
    run: async (ctx) =>
      rows(
        ctx.db
          .from('admin_broadcasts')
          .select('target_districts, level, title_en, sent_at')
          .not('sent_at', 'is', null)
          .gt('sent_at', new Date(ctx.now.getTime() - 48 * 3600_000).toISOString())
          .limit(20),
      ),
  },
};

export const TOOL_DEFINITIONS = Object.entries(TOOLS).map(([name, t]) => ({
  type: 'function' as const,
  function: {
    name,
    description: t.description,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
}));

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const levelSchema = z.enum(RISK_LEVELS.filter((l) => l !== 'none') as [RiskLevel, ...RiskLevel[]]);

export const briefingSchema = z.object({
  summary_en: z.string().trim().min(20).max(2000),
  summary_ms: z.string().trim().min(20).max(2000),
  suggestions: z
    .array(
      z.object({
        districts: z.array(z.string()).min(1),
        level: levelSchema,
        title_en: z.string().trim().min(3).max(120),
        title_ms: z.string().trim().min(3).max(120),
        body_en: z.string().trim().min(3).max(500),
        body_ms: z.string().trim().min(3).max(500),
        why: z.string().trim().max(300).default(''),
      }),
    )
    .max(5)
    .default([]),
});
export type Briefing = z.infer<typeof briefingSchema>;

/** Pull the JSON object out of a reply (models sometimes wrap it in prose or ``` fences). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Validate and keep only suggestions for real districts. */
export function parseBriefing(text: string, districts: string[]): Briefing {
  const parsed = briefingSchema.parse(extractJson(text));
  const known = new Set(districts);
  return {
    ...parsed,
    suggestions: parsed.suggestions
      .map((s) => ({ ...s, districts: s.districts.filter((d) => known.has(d)) }))
      .filter((s) => s.districts.length > 0),
  };
}

export const SYSTEM_PROMPT = `You are the briefing assistant for JagaSekitar, a hazard early-warning system for Perak, Malaysia, used by state disaster officials.

Use the tools to get the current situation. Call every tool you need before answering (you may call several at once). Never invent data: every fact must come from a tool result. If a tool returns nothing, say there is nothing of that kind. If data sources are stale (minutes_since_success large), say so.

Hazard zones are RISK PREDICTIONS from models, not confirmed events: write "flood risk is high in Kerian", never "Kerian is flooding". Official alerts (JPS, MetMalaysia) are authoritative; name the source.

Bahasa Melayu (Malaysian, not Indonesian): haze = jerebu (never "kabut asap"), flood = banjir, risk = risiko, risk levels low/moderate/high/severe = rendah/sederhana/tinggi/teruk, district = daerah, river = sungai, relief centre = pusat pemindahan sementara (PPS).

Suggest a broadcast only for districts with HIGH or SEVERE risk or an official alert, and not if one was already sent there in the last 48 hours. Broadcast text must be calm, practical, under 400 characters, and must not promise anything (no "you are safe").

Reply with ONLY a JSON object, no other text:
{
  "summary_en": "3-6 sentences: what is happening now, where, how sure, and data freshness",
  "summary_ms": "the same in Bahasa Melayu",
  "suggestions": [
    { "districts": ["exact district names from get_districts"], "level": "high", "title_en": "...", "title_ms": "...", "body_en": "...", "body_ms": "...", "why": "which data this is based on" }
  ]
}`;

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface AgentResult {
  briefing: Briefing;
  toolsUsed: { tool: string; rows: number }[];
  usage: { prompt_tokens: number; completion_tokens: number; calls: number };
}

type Fetch = typeof fetch;

/**
 * Some models (e.g. GPT-OSS) leak their internal channel markers into tool names, like
 * "get_active_zones<|channel|>commentary". Keep only the name.
 */
export function toolName(raw: string): string {
  return raw.split('<|')[0]!.trim();
}

/** "21 Oct 2026, 1:51 am" in Malaysia time. */
export function mytTime(d: Date): string {
  return d.toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function chat(cfg: AiConfig, messages: ChatMessage[], fetchImpl: Fetch, withTools: boolean) {
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      ...(withTools ? { tools: TOOL_DEFINITIONS, tool_choice: 'auto' } : {}),
      temperature: 0.2,
      max_tokens: 2500,
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI API ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as {
    choices?: { message?: ChatMessage }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error('AI API returned no message');
  return { message, usage: json.usage ?? {} };
}

export async function runBriefingAgent(
  cfg: AiConfig,
  ctx: ToolContext,
  fetchImpl: Fetch = fetch,
  maxSteps = 10,
): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Write the situation briefing for ${ctx.stateName} as of ${mytTime(ctx.now)} Malaysia time. Use Malaysia time in the briefing, never UTC.`,
    },
  ];
  const toolsUsed: AgentResult['toolsUsed'] = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, calls: 0 };
  let districts: string[] | null = null;

  for (let step = 0; step < maxSteps; step++) {
    const { message, usage: u } = await chat(cfg, messages, fetchImpl, true);
    usage.calls++;
    usage.prompt_tokens += u.prompt_tokens ?? 0;
    usage.completion_tokens += u.completion_tokens ?? 0;
    messages.push({
      role: 'assistant',
      content: message.content ?? '',
      tool_calls: message.tool_calls,
    });

    if (message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        const name = toolName(call.function.name);
        const tool = TOOLS[name];
        let result: unknown[];
        try {
          result = tool ? await tool.run(ctx, {}) : [];
        } catch (err) {
          result = [{ error: err instanceof Error ? err.message : String(err) }];
        }
        if (name === 'get_districts') districts = result as string[];
        toolsUsed.push({ tool: name, rows: result.length });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: tool ? JSON.stringify(result) : `Unknown tool ${name}`,
        });
      }
      continue;
    }

    // Final answer. Every claim must be backed by data: if the model skipped a tool, fetch that
    // data now, show it, and ask for a revised answer (it once claimed "all data are fresh"
    // without ever checking).
    const called = new Set(toolsUsed.map((t) => t.tool));
    const missing = Object.keys(TOOLS).filter((n) => !called.has(n));
    if (missing.length && step < maxSteps - 1) {
      const extra: Record<string, unknown[]> = {};
      for (const n of missing) {
        const result = await TOOLS[n]!.run(ctx, {}).catch((e: unknown) => [{ error: String(e) }]);
        if (n === 'get_districts') districts = result as string[];
        toolsUsed.push({ tool: n, rows: result.length });
        extra[n] = result;
      }
      messages.push({
        role: 'user',
        content: `You answered without checking: ${missing.join(', ')}. Here is that data:
${JSON.stringify(extra)}
Revise your briefing so it is consistent with ALL the data (remove any claim the data does not support), and reply with ONLY the JSON object.`,
      });
      continue;
    }
    districts ??= (await TOOLS.get_districts!.run(ctx, {})) as string[];
    try {
      return { briefing: parseBriefing(message.content ?? '', districts), toolsUsed, usage };
    } catch (err) {
      // One repair attempt: show the model what was wrong.
      if (step === maxSteps - 1) throw err;
      messages.push({
        role: 'user',
        content: `That reply was not valid (${err instanceof Error ? err.message.slice(0, 300) : 'invalid'}). Reply again with ONLY the JSON object in the required format.`,
      });
    }
  }
  throw new Error(`The agent did not finish within ${maxSteps} steps`);
}
