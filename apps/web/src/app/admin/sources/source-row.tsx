'use client';
import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { refreshSourceNow, updateSource } from '../actions';

export interface SourceInfo {
  source: string;
  enabled: boolean;
  refresh_minutes: number;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  last_record_count: number | null;
  used_mock: boolean;
  last_payload: unknown;
  refresh_requested_at: string | null;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) : '–';

export function SourceRow({ source: s }: { source: SourceInfo }) {
  const [minutes, setMinutes] = useState(String(s.refresh_minutes));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-sm font-semibold">{s.source}</h2>
        <span
          className={`text-sm ${s.enabled ? 'text-green-700 dark:text-green-400' : 'text-neutral-500'}`}
        >
          {s.enabled ? '● Enabled' : '○ Paused'}
        </span>
        {s.used_mock && (
          <span className="text-sm text-amber-700 dark:text-amber-400">
            ◐ Last run used mock data
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ActionButton action={() => updateSource(s.source, { enabled: !s.enabled })}>
            {s.enabled ? 'Pause' : 'Enable'}
          </ActionButton>
          <ActionButton action={() => refreshSourceNow(s.source)}>↻ Refresh now</ActionButton>
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-neutral-500">Last success</dt>
          <dd>{fmt(s.last_success_at)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Last error</dt>
          <dd>{fmt(s.last_error_at)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Records last run</dt>
          <dd>{s.last_record_count ?? '–'}</dd>
        </div>
      </dl>
      {s.last_error && (
        <p className="text-xs break-words text-red-700 dark:text-red-400">{s.last_error}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Refresh every (minutes)
          <input
            type="number"
            min={5}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-28 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <ActionButton action={() => updateSource(s.source, { refresh_minutes: Number(minutes) })}>
          Save interval
        </ActionButton>
        {s.refresh_requested_at && (
          <span className="text-xs text-neutral-500">
            Refresh requested {fmt(s.refresh_requested_at)}
          </span>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">
          Last raw payload (sample)
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-neutral-50 p-3 text-xs dark:bg-neutral-900">
          {JSON.stringify(s.last_payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
