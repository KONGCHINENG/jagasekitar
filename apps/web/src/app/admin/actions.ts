'use server';
// Admin Server Actions. Each re-checks the admin role, then acts with the admin's own session so
// RLS applies and the audit-log triggers record who did what.
import { RISK_LEVELS } from '@jagasekitar/shared';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { sendPush } from '@/lib/push';
import { createClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };
const ok = (message?: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });

async function admin() {
  await requireAdmin();
  return createClient();
}

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------
export async function updateSource(
  source: string,
  patch: { enabled?: boolean; refresh_minutes?: number },
): Promise<ActionResult> {
  const supabase = await admin();
  const values: Record<string, unknown> = {};
  if (typeof patch.enabled === 'boolean') values.enabled = patch.enabled;
  if (patch.refresh_minutes !== undefined) {
    const m = Math.round(Number(patch.refresh_minutes));
    // Never poll JPS more often than every 15 minutes (be polite); cap at a day.
    const min = source.startsWith('infobanjir') ? 15 : 5;
    if (!Number.isFinite(m) || m < min || m > 1440)
      return fail(`Refresh interval must be ${min}–1440 minutes`);
    values.refresh_minutes = m;
  }
  const { error } = await supabase.from('data_source_status').update(values).eq('source', source);
  return error ? fail(error.message) : ok('Saved');
}

export async function refreshSourceNow(source: string): Promise<ActionResult> {
  const supabase = await admin();
  const { error } = await supabase
    .from('data_source_status')
    .update({ refresh_requested_at: new Date().toISOString() })
    .eq('source', source);
  return error ? fail(error.message) : ok('Requested: the worker refreshes it within a minute');
}

// ---------------------------------------------------------------------------
// Thresholds & model settings
// ---------------------------------------------------------------------------
const EDITABLE_SETTINGS = [
  'haze',
  'flood',
  'disease',
  'notifications',
  'refresh_minutes',
  'retention_hours',
  'stale_data_minutes',
];

export async function saveSetting(key: string, value: unknown): Promise<ActionResult> {
  if (!EDITABLE_SETTINGS.includes(key)) return fail('This setting cannot be edited here');
  const supabase = await admin();
  const { data: current } = await supabase.from('settings').select('value').eq('key', key).single();
  if (!current) return fail('Setting not found');
  // Keep the stored shape: same keys, same types (numbers stay numbers, arrays stay arrays).
  const problem = shapeMismatch(current.value, value);
  if (problem) return fail(problem);
  const { error } = await supabase.from('settings').update({ value }).eq('key', key);
  return error ? fail(error.message) : ok('Saved. Re-run predictions to apply now.');
}

function shapeMismatch(expected: unknown, actual: unknown, path = ''): string | null {
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Number.isFinite(actual) && actual >= 0
      ? null
      : `${path || 'value'} must be a number ≥ 0`;
  }
  if (typeof expected === 'string') {
    if (RISK_LEVELS.includes(expected as never))
      return RISK_LEVELS.includes(actual as never) ? null : `${path} must be a risk level`;
    return typeof actual === 'string' ? null : `${path} must be text`;
  }
  if (typeof expected === 'boolean')
    return typeof actual === 'boolean' ? null : `${path} must be true/false`;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path} must be a list`;
    const sample = expected[0];
    return sample === undefined
      ? null
      : (actual.map((a, i) => shapeMismatch(sample, a, `${path}[${i}]`)).find(Boolean) ?? null);
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual))
      return `${path || 'value'} must be an object`;
    for (const k of Object.keys(expected)) {
      const m = shapeMismatch(
        (expected as Record<string, unknown>)[k],
        (actual as Record<string, unknown>)[k],
        path ? `${path}.${k}` : k,
      );
      if (m) return m;
    }
    return Object.keys(actual).every((k) => k in expected)
      ? null
      : `${path || 'value'} has unknown fields`;
  }
  return null;
}

export async function requestPredictionRun(): Promise<ActionResult> {
  const supabase = await admin();
  const { error } = await supabase
    .from('settings')
    .update({ value: { predict_at: new Date().toISOString() } })
    .eq('key', 'worker_requests');
  return error
    ? fail(error.message)
    : ok('Requested: the worker re-runs predictions within a minute');
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------
const stationTable = (kind: string) => (kind === 'rain' ? 'rain_stations' : 'water_level_stations');

export async function moveStation(
  kind: string,
  stationId: string,
  lat: number,
  lon: number,
): Promise<ActionResult> {
  if (![lat, lon].every(Number.isFinite) || lat < 0 || lat > 8 || lon < 98 || lon > 120)
    return fail('Location is outside Malaysia');
  const supabase = await admin();
  const { error } = await supabase
    .from(stationTable(kind))
    .update({ geom: `SRID=4326;POINT(${lon} ${lat})`, coords_source: 'admin' })
    .eq('station_id', stationId);
  return error ? fail(error.message) : ok('Location saved');
}

export async function setStationActive(
  kind: string,
  stationId: string,
  active: boolean,
): Promise<ActionResult> {
  const supabase = await admin();
  const { error } = await supabase
    .from(stationTable(kind))
    .update({ active })
    .eq('station_id', stationId);
  return error ? fail(error.message) : ok();
}

// ---------------------------------------------------------------------------
// Facilities, join requests, reports
// ---------------------------------------------------------------------------
export async function reviewJoin(requestId: string, approve: boolean): Promise<ActionResult> {
  const supabase = await admin();
  const { error } = await supabase.rpc('admin_review_join', {
    p_request: requestId,
    p_approve: approve,
  });
  return error ? fail(error.message) : ok(approve ? 'Approved' : 'Rejected');
}

export async function updateFacility(
  id: string,
  patch: { verified?: boolean; active?: boolean },
): Promise<ActionResult> {
  const supabase = await admin();
  const { error } = await supabase.from('facilities').update(patch).eq('id', id);
  return error ? fail(error.message) : ok();
}

export async function reviewReport(
  id: string,
  status: 'verified' | 'rejected',
): Promise<ActionResult> {
  const supabase = await admin();
  const { error } = await supabase
    .from('case_reports')
    .update({ status, flagged: false })
    .eq('id', id);
  return error ? fail(error.message) : ok();
}

export async function reviewEdit(id: string, approve: boolean): Promise<ActionResult> {
  const supabase = await admin();
  const { error } = await supabase.rpc('admin_review_edit', { p_edit: id, p_approve: approve });
  return error ? fail(error.message) : ok(approve ? 'Applied' : 'Rejected');
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function setUser(
  id: string,
  role: string,
  facilityId: string | null,
  active: boolean,
): Promise<ActionResult> {
  if (!['user', 'hospital_staff', 'admin'].includes(role)) return fail('Unknown role');
  const supabase = await admin();
  const { error } = await supabase.rpc('admin_set_user', {
    p_user: id,
    p_role: role,
    p_facility: facilityId,
    p_active: active,
  });
  return error ? fail(error.message) : ok('Saved');
}

// ---------------------------------------------------------------------------
// Demo mode (scenario replay is implemented by the worker)
// ---------------------------------------------------------------------------
const demoSchema = z.object({
  enabled: z.boolean(),
  scenario: z.enum(['riau_haze', 'kerian_flood', 'post_flood_disease']).nullable(),
  speed: z.number().int().min(1).max(120),
});

export async function setDemoMode(input: unknown): Promise<ActionResult> {
  const parsed = demoSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);
  const supabase = await admin();
  const { data: current } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'demo_mode')
    .single();
  const prev = (current?.value ?? {}) as {
    enabled?: boolean;
    scenario?: string | null;
    offset_minutes?: number;
  };
  // Starting or switching a scenario restarts its clock.
  const restart = parsed.data.enabled && (!prev.enabled || prev.scenario !== parsed.data.scenario);
  const value = {
    ...prev,
    ...parsed.data,
    started_at: restart
      ? new Date().toISOString()
      : ((prev as { started_at?: string }).started_at ?? null),
    offset_minutes: restart ? 0 : (prev.offset_minutes ?? 0),
  };
  const { error } = await supabase.from('settings').update({ value }).eq('key', 'demo_mode');
  return error ? fail(error.message) : ok(parsed.data.enabled ? 'Demo mode on' : 'Demo mode off');
}

export async function fastForwardDemo(minutes: number): Promise<ActionResult> {
  const supabase = await admin();
  const { data } = await supabase.from('settings').select('value').eq('key', 'demo_mode').single();
  const v = (data?.value ?? {}) as { enabled?: boolean; offset_minutes?: number };
  if (!v.enabled) return fail('Turn demo mode on first');
  const offset = Math.min(
    (v.offset_minutes ?? 0) + Math.max(0, Math.min(minutes, 24 * 60)),
    7 * 24 * 60,
  );
  const { error } = await supabase
    .from('settings')
    .update({ value: { ...v, offset_minutes: offset } })
    .eq('key', 'demo_mode');
  return error ? fail(error.message) : ok(`Demo clock +${offset} min`);
}

// ---------------------------------------------------------------------------
// Broadcast alert
// ---------------------------------------------------------------------------
const broadcastSchema = z.object({
  districts: z.array(z.string()).min(1, 'Choose at least one district'),
  level: z.enum(RISK_LEVELS),
  titleEn: z.string().trim().min(3, 'English title is required').max(120),
  titleMs: z.string().trim().max(120).optional(),
  bodyEn: z.string().trim().min(3, 'English message is required').max(500),
  bodyMs: z.string().trim().max(500).optional(),
});

export async function previewBroadcast(
  districts: string[],
): Promise<{ devices: number; withPush: number } | { error: string }> {
  const supabase = await admin();
  const { data, error } = await supabase.rpc('broadcast_targets', {
    p_state: 'PRK',
    p_districts: districts,
  });
  if (error) return { error: error.message };
  const rows = (data ?? []) as { expo_push_token: string | null }[];
  return { devices: rows.length, withPush: rows.filter((r) => r.expo_push_token).length };
}

export async function sendBroadcast(input: unknown): Promise<ActionResult> {
  const parsed = broadcastSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);
  const b = parsed.data;
  const supabase = await admin();

  const { data: id, error: cErr } = await supabase.rpc('admin_create_broadcast', {
    p_state: 'PRK',
    p_districts: b.districts,
    p_level: b.level,
    p_title_en: b.titleEn,
    p_title_ms: b.titleMs || null,
    p_body_en: b.bodyEn,
    p_body_ms: b.bodyMs || null,
  });
  if (cErr) return fail(cErr.message);

  const { data: targets, error: tErr } = await supabase.rpc('broadcast_targets', {
    p_state: 'PRK',
    p_districts: b.districts,
  });
  if (tErr) return fail(tErr.message);
  const devices = (targets ?? []) as {
    device_id: string;
    user_id: string;
    expo_push_token: string | null;
    language: 'en' | 'ms';
  }[];

  const message = (d: (typeof devices)[number]) => ({
    title: `📢 ${d.language === 'ms' && b.titleMs ? b.titleMs : b.titleEn}`,
    body: d.language === 'ms' && b.bodyMs ? b.bodyMs : b.bodyEn,
  });
  const data = { screen: '/alerts', broadcastId: id };
  const results = await sendPush(
    devices
      .filter((d) => d.expo_push_token)
      .map((d) => ({ to: d.expo_push_token!, ...message(d), data })),
  );
  const delivered = new Set(results.filter((r) => r.ok).map((r) => r.token));
  const dead = results.filter((r) => r.unregistered).map((r) => r.token);
  if (dead.length)
    await supabase
      .from('user_devices')
      .update({ expo_push_token: null })
      .in('expo_push_token', dead);

  if (devices.length) {
    const { error: nErr } = await supabase.from('notifications').insert(
      devices.map((d) => ({
        user_id: d.user_id,
        device_id: d.device_id,
        hazard: null,
        level: b.level,
        broadcast_id: id,
        ...message(d),
        data,
        delivery: d.expo_push_token && delivered.has(d.expo_push_token) ? 'push' : 'in_app',
      })),
    );
    if (nErr) return fail(`Broadcast saved but alerts were not logged: ${nErr.message}`);
  }
  await supabase
    .from('admin_broadcasts')
    .update({ sent_at: new Date().toISOString(), recipient_count: devices.length })
    .eq('id', id);
  return ok(
    `Sent to ${devices.length} device${devices.length === 1 ? '' : 's'} (${delivered.size} by push, the rest in-app)`,
  );
}
