// notify_affected_users: runs after each prediction run.
// Candidates (devices / saved places inside zones) → rules → Expo push or in-app → notifications log.
import type { RiskLevel } from '@jagasekitar/shared';
import { getSetting } from '../core/db';
import { log } from '../core/log';
import type { SourceContext } from '../core/source';
import {
  composeMessage,
  decideNotifications,
  deepLinkFor,
  type Candidate,
  type RecentNotification,
} from './decide';
import { sendPush } from './expo-push';

export interface NotifyResult {
  candidates: number;
  sent: number;
  push: number;
  inApp: number;
  removedTokens: number;
}

export async function runNotifications(ctx: SourceContext): Promise<NotifyResult> {
  const settings = await getSetting(ctx.db, 'notifications', {
    dedupe_hours: 6,
    batch_size: 100,
    quiet_hours_bypass_level: 'severe' as RiskLevel,
  });

  const { data: candidates, error } = await ctx.db.rpc('notify_candidates', {
    p_horizon_hours: 24,
    p_seen_days: 7,
  });
  if (error) throw new Error(`notify_candidates: ${error.message}`);
  const list = (candidates ?? []) as Candidate[];
  if (list.length === 0) return { candidates: 0, sent: 0, push: 0, inApp: 0, removedTokens: 0 };

  const since = new Date(ctx.now.getTime() - settings.dedupe_hours * 3600_000).toISOString();
  const { data: recent, error: rErr } = await ctx.db
    .from('notifications')
    .select('device_id, hazard, level, place_id, sent_at')
    .in('device_id', [...new Set(list.map((c) => c.device_id))])
    .gte('sent_at', since);
  if (rErr) throw new Error(`recent notifications: ${rErr.message}`);

  const decisions = decideNotifications(list, (recent ?? []) as RecentNotification[], {
    now: ctx.now,
    dedupeHours: settings.dedupe_hours,
    quietBypassLevel: settings.quiet_hours_bypass_level,
  });

  const outgoing = decisions.map(({ candidate: c }) => {
    const msg = composeMessage(c, ctx.now);
    const link = deepLinkFor(c);
    return { c, msg, data: { ...link, hazard: c.hazard, level: c.level, zoneId: c.zone_id } };
  });

  // Push where we have a token; everyone else gets the in-app alert via Realtime.
  const withToken = outgoing.filter((o) => o.c.expo_push_token);
  const results = withToken.length
    ? await sendPush(
        withToken.map((o) => ({
          to: o.c.expo_push_token!,
          title: o.msg.title,
          body: o.msg.body,
          data: o.data,
        })),
        settings.batch_size,
      )
    : [];
  const delivered = new Set(results.filter((r) => r.ok).map((r) => r.token));
  const dead = results.filter((r) => r.unregistered).map((r) => r.token);
  for (const r of results.filter((x) => !x.ok && !x.unregistered))
    log.warn('notify', `push failed: ${r.error}`);

  if (dead.length) {
    const { error: dErr } = await ctx.db
      .from('user_devices')
      .update({ expo_push_token: null })
      .in('expo_push_token', dead);
    if (dErr) log.warn('notify', `could not clear dead tokens: ${dErr.message}`);
  }

  const rows = outgoing.map((o) => ({
    user_id: o.c.user_id,
    device_id: o.c.device_id,
    hazard: o.c.hazard,
    level: o.c.level,
    zone_id: o.c.zone_id,
    zone_key: o.c.zone_key,
    place_id: o.c.place_id,
    title: o.msg.title,
    body: o.msg.body,
    data: o.data,
    delivery: o.c.expo_push_token && delivered.has(o.c.expo_push_token) ? 'push' : 'in_app',
  }));
  if (rows.length) {
    const { error: iErr } = await ctx.db.from('notifications').insert(rows);
    if (iErr) throw new Error(`notifications insert: ${iErr.message}`);
  }
  const push = rows.filter((r) => r.delivery === 'push').length;
  const result = {
    candidates: list.length,
    sent: rows.length,
    push,
    inApp: rows.length - push,
    removedTokens: dead.length,
  };
  log.info(
    'notify',
    `${result.sent} alerts (${push} push, ${result.inApp} in-app) from ${list.length} candidates`,
  );
  return result;
}
