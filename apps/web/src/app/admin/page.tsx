import {
  RISK_COLORS,
  RISK_ICONS,
  RISK_LABELS,
  RISK_LEVELS,
  type Hazard,
  type RiskLevel,
} from '@jagasekitar/shared';
import Link from 'next/link';
import { Suspense } from 'react';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { requestTime } from '@/lib/time';

export const metadata = { title: 'Overview · Admin' };

export default function AdminOverview() {
  return (
    <>
      <PageTitle sub="Live state of zones, users, alerts and data sources.">Overview</PageTitle>
      <Suspense fallback={<Skeleton h="h-96" />}>
        <OverviewBody />
      </Suspense>
    </>
  );
}

const HAZARDS: { key: Hazard; label: string; icon: string }[] = [
  { key: 'haze', label: 'Haze', icon: '🌫️' },
  { key: 'flood', label: 'Flood', icon: '🌊' },
  { key: 'disease', label: 'Illness', icon: '🦠' },
];

async function OverviewBody() {
  await requireAdmin();
  const supabase = await createClient();
  const now = await requestTime();
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const nowIso = now.toISOString();
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const [
    zones,
    sources,
    users,
    staff,
    devices,
    pushDevices,
    sent24,
    pendingJoins,
    flagged,
    pendingEdits,
    runs,
  ] = await Promise.all([
    supabase
      .from('hazard_zones')
      .select('hazard, level')
      .lte('valid_from', nowIso)
      .gt('valid_to', nowIso),
    supabase
      .from('data_source_status')
      .select(
        'source, enabled, last_success_at, last_error_at, last_error, last_record_count, used_mock',
      )
      .order('source'),
    count(supabase.from('profiles').select('*', { count: 'exact', head: true })),
    count(
      supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'hospital_staff'),
    ),
    count(supabase.from('user_devices').select('*', { count: 'exact', head: true })),
    count(
      supabase
        .from('user_devices')
        .select('*', { count: 'exact', head: true })
        .not('expo_push_token', 'is', null),
    ),
    count(
      supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .gte('sent_at', since),
    ),
    count(
      supabase
        .from('facility_join_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ),
    count(
      supabase
        .from('case_reports')
        .select('*', { count: 'exact', head: true })
        .eq('flagged', true)
        .eq('status', 'submitted'),
    ),
    count(
      supabase
        .from('case_report_edits')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ),
    supabase
      .from('prediction_runs')
      .select('hazard, status, started_at, error')
      .order('started_at', { ascending: false })
      .limit(6),
  ]);

  const byHazard = (h: Hazard, l: RiskLevel) =>
    (zones.data ?? []).filter((z) => z.hazard === h && z.level === l).length;
  const levels = RISK_LEVELS.filter((l) => l !== 'none');
  const STALE_MS = 2 * 3600_000;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users (incl. anonymous)" value={users} />
        <Stat label="Devices registered" value={devices} sub={`${pushDevices} with push`} />
        <Stat label="Alerts sent, last 24 h" value={sent24} />
        <Stat label="Hospital staff" value={staff} />
      </div>

      {(pendingJoins > 0 || flagged > 0 || pendingEdits > 0) && (
        <Card title="Needs your attention">
          <ul className="flex flex-col gap-1 text-sm">
            {pendingJoins > 0 && (
              <li>
                <Link
                  className="text-cyan-800 underline dark:text-cyan-300"
                  href="/admin/facilities"
                >
                  {pendingJoins} facility access request{pendingJoins === 1 ? '' : 's'}
                </Link>
              </li>
            )}
            {(flagged > 0 || pendingEdits > 0) && (
              <li>
                <Link className="text-cyan-800 underline dark:text-cyan-300" href="/admin/reports">
                  {flagged} flagged report{flagged === 1 ? '' : 's'} and {pendingEdits} change
                  request{pendingEdits === 1 ? '' : 's'}
                </Link>
              </li>
            )}
          </ul>
        </Card>
      )}

      <Card title="Active zones">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-600 dark:text-neutral-400">
            <tr>
              <th className="pb-2 font-medium">Hazard</th>
              {levels.map((l) => (
                <th key={l} className="pb-2 text-right font-medium">
                  <span style={{ color: RISK_COLORS[l] }}>{RISK_ICONS[l]}</span> {RISK_LABELS[l].en}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HAZARDS.map((h) => (
              <tr key={h.key} className="border-t border-neutral-100 dark:border-neutral-900">
                <td className="py-2">
                  {h.icon} {h.label}
                </td>
                {levels.map((l) => (
                  <td key={l} className="py-2 text-right tabular-nums">
                    {byHazard(h.key, l) || <span className="text-neutral-400">0</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Data-source health">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-600 dark:text-neutral-400">
            <tr>
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Last success</th>
              <th className="pb-2 text-right font-medium">Records</th>
              <th className="pb-2 font-medium">Last error</th>
            </tr>
          </thead>
          <tbody>
            {(sources.data ?? []).map((s) => {
              const okRecent =
                s.last_success_at && now.getTime() - Date.parse(s.last_success_at) < STALE_MS;
              const erroredLater =
                s.last_error_at && (!s.last_success_at || s.last_error_at > s.last_success_at);
              const state = !s.enabled
                ? 'off'
                : okRecent && !erroredLater
                  ? s.used_mock
                    ? 'mock'
                    : 'ok'
                  : 'down';
              const badge = {
                ok: { text: '● Live', cls: 'text-green-700 dark:text-green-400' },
                mock: { text: '◐ Mock data', cls: 'text-amber-700 dark:text-amber-400' },
                down: { text: '✕ Failing / stale', cls: 'text-red-700 dark:text-red-400' },
                off: { text: '○ Disabled', cls: 'text-neutral-500' },
              }[state];
              return (
                <tr key={s.source} className="border-t border-neutral-100 dark:border-neutral-900">
                  <td className="py-2 font-mono text-xs">{s.source}</td>
                  <td className={`py-2 font-medium ${badge.cls}`}>{badge.text}</td>
                  <td className="py-2">
                    {s.last_success_at
                      ? new Date(s.last_success_at).toLocaleString('en-MY', {
                          timeZone: 'Asia/Kuala_Lumpur',
                        })
                      : '–'}
                  </td>
                  <td className="py-2 text-right tabular-nums">{s.last_record_count ?? '–'}</td>
                  <td
                    className="max-w-72 truncate py-2 text-xs text-neutral-500"
                    title={s.last_error ?? ''}
                  >
                    {s.last_error ?? ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Recent prediction runs">
        <ul className="text-sm">
          {(runs.data ?? []).map((r, i) => (
            <li
              key={i}
              className="flex gap-3 border-t border-neutral-100 py-1.5 first:border-0 dark:border-neutral-900"
            >
              <span className="w-16">{r.hazard}</span>
              <span
                className={
                  r.status === 'success'
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-red-700 dark:text-red-400'
                }
              >
                {r.status}
              </span>
              <span className="text-neutral-500">
                {new Date(r.started_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
              </span>
              {r.error && <span className="truncate text-xs text-red-700">{r.error}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}
