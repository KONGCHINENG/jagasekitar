// Runs queued AI briefings (Admin → AI briefing → Generate) and the optional morning briefing.
// Called once per worker tick; never throws.
import { MALAYSIA_STATES } from '@jagasekitar/shared';
import { getSetting } from '../core/db';
import { redactUrl } from '../core/http';
import { log } from '../core/log';
import type { SourceContext } from '../core/source';
import { aiConfigFromEnv, runBriefingAgent } from './agent';

interface AiSettings {
  daily_briefing: boolean;
  briefing_hour_myt: number;
  daily_limit: number;
}
const DEFAULTS: AiSettings = { daily_briefing: true, briefing_hour_myt: 7, daily_limit: 20 };
const MYT_OFFSET_MS = 8 * 3600_000;

/** Start of today in Malaysia time, as a UTC ISO string. */
export function mytMidnight(now: Date): string {
  const myt = new Date(now.getTime() + MYT_OFFSET_MS);
  myt.setUTCHours(0, 0, 0, 0);
  return new Date(myt.getTime() - MYT_OFFSET_MS).toISOString();
}

export async function runBriefings(ctx: SourceContext): Promise<void> {
  try {
    await tick(ctx);
  } catch (err) {
    log.error('ai', err instanceof Error ? err.message : String(err));
  }
}

async function tick(ctx: SourceContext): Promise<void> {
  const cfg = aiConfigFromEnv();
  const settings = { ...DEFAULTS, ...(await getSetting<Partial<AiSettings>>(ctx.db, 'ai', {})) };
  const since = mytMidnight(ctx.now);

  // Morning briefing: once a day after the configured hour, only when a key is set.
  const mytHour = new Date(ctx.now.getTime() + MYT_OFFSET_MS).getUTCHours();
  if (cfg && settings.daily_briefing && mytHour >= settings.briefing_hour_myt) {
    const { count } = await ctx.db
      .from('ai_briefings')
      .select('id', { count: 'exact', head: true })
      .eq('trigger', 'scheduled')
      .gte('created_at', since);
    if (!count) await ctx.db.from('ai_briefings').insert({ trigger: 'scheduled' });
  }

  const { data: queued, error } = await ctx.db
    .from('ai_briefings')
    .select('id')
    .eq('status', 'queued')
    .order('created_at')
    .limit(3);
  if (error) throw new Error(`ai_briefings: ${error.message}`);
  for (const { id } of queued ?? []) {
    const fail = (message: string) =>
      ctx.db
        .from('ai_briefings')
        .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
        .eq('id', id);

    if (!cfg) {
      await fail('No AI key: set NVIDIA_API_KEY (or AI_API_KEY) where the worker runs.');
      continue;
    }
    const { count: used } = await ctx.db
      .from('ai_briefings')
      .select('id', { count: 'exact', head: true })
      .in('status', ['running', 'done'])
      .gte('created_at', since);
    if ((used ?? 0) >= settings.daily_limit) {
      await fail(`Daily limit reached (${settings.daily_limit}); change it in Thresholds → ai.`);
      continue;
    }

    await ctx.db
      .from('ai_briefings')
      .update({ status: 'running', model: cfg.model, started_at: new Date().toISOString() })
      .eq('id', id);
    const started = Date.now();
    try {
      const stateName = (
        MALAYSIA_STATES[ctx.state as keyof typeof MALAYSIA_STATES] ?? ctx.state
      ).toUpperCase();
      const result = await runBriefingAgent(cfg, {
        db: ctx.db,
        state: ctx.state,
        stateName,
        now: new Date(),
      });
      await ctx.db
        .from('ai_briefings')
        .update({
          status: 'done',
          summary_en: result.briefing.summary_en,
          summary_ms: result.briefing.summary_ms,
          suggestions: result.briefing.suggestions,
          tools_used: result.toolsUsed,
          usage: { ...result.usage, ms: Date.now() - started },
          finished_at: new Date().toISOString(),
        })
        .eq('id', id);
      log.info(
        'ai',
        `briefing ${id} done in ${Math.round((Date.now() - started) / 1000)} s (${result.usage.calls} model calls)`,
      );
    } catch (err) {
      const message = redactUrl(err instanceof Error ? err.message : String(err)).slice(0, 500);
      log.warn('ai', `briefing ${id} failed: ${message}`);
      await fail(message);
    }
  }
}
