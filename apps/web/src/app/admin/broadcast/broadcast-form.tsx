'use client';
import {
  RISK_COLORS,
  RISK_ICONS,
  RISK_LABELS,
  RISK_LEVELS,
  type RiskLevel,
} from '@jagasekitar/shared';
import type { MultiPolygon, Polygon } from 'geojson';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { PortalMap } from '@/components/portal-map';
import { Card } from '@/components/ui';
import { previewBroadcast, sendBroadcast } from '../actions';

const input =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

export function BroadcastForm({
  districts,
}: {
  districts: { name: string; geometry: Polygon | MultiPolygon | null }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [level, setLevel] = useState<RiskLevel>('high');
  const [titleEn, setTitleEn] = useState('');
  const [titleMs, setTitleMs] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [bodyMs, setBodyMs] = useState('');
  const [preview, setPreview] = useState<{ devices: number; withPush: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (name: string) => {
    setPreview(null);
    setConfirming(false);
    setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
  };

  const areas = useMemo(
    () =>
      districts
        .filter((d) => d.geometry)
        .map((d) => ({
          id: d.name,
          geometry: d.geometry!,
          color: selected.includes(d.name) ? RISK_COLORS[level] : '#94a3b8',
          opacity: selected.includes(d.name) ? 0.5 : 0.08,
          outline: '#334155',
        })),
    [districts, selected, level],
  );

  const ready = selected.length > 0 && titleEn.trim().length >= 3 && bodyEn.trim().length >= 3;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="1. Choose the area">
        <PortalMap areas={areas} onAreaClick={toggle} height="h-[420px]" />
        <div className="mt-3 flex flex-wrap gap-2">
          {districts.map((d) => (
            <button
              key={d.name}
              type="button"
              onClick={() => toggle(d.name)}
              aria-pressed={selected.includes(d.name)}
              className={`rounded-full px-3 py-1 text-xs ${selected.includes(d.name) ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'border border-neutral-300 dark:border-neutral-700'}`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </Card>

      <Card title="2. Write the alert">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const p = await previewBroadcast(selected);
              if ('error' in p) setResult({ ok: false, message: p.error });
              else {
                setPreview(p);
                setConfirming(true);
              }
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Level
            <select
              className={input}
              value={level}
              onChange={(e) => setLevel(e.target.value as RiskLevel)}
            >
              {RISK_LEVELS.filter((l) => l !== 'none').map((l) => (
                <option key={l} value={l}>
                  {RISK_ICONS[l]} {RISK_LABELS[l].en}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Title (English)
            <input
              className={input}
              maxLength={120}
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              placeholder="Evacuation centre open at SK Bagan Serai"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Message (English)
            <textarea
              className={input}
              rows={3}
              maxLength={500}
              value={bodyEn}
              onChange={(e) => setBodyEn(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Tajuk (Bahasa Melayu, optional)
            <input
              className={input}
              maxLength={120}
              value={titleMs}
              onChange={(e) => setTitleMs(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Mesej (Bahasa Melayu, optional)
            <textarea
              className={input}
              rows={3}
              maxLength={500}
              value={bodyMs}
              onChange={(e) => setBodyMs(e.target.value)}
            />
          </label>

          <div className="rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900">
            <p className="text-xs font-medium text-neutral-500">Phone preview</p>
            <p className="mt-1 font-semibold">📢 {titleEn || 'Title'}</p>
            <p className="text-cyan-800 dark:text-cyan-300">
              📍 Area: {selected.length ? selected.join(', ') : 'choose districts'}
            </p>
            <p>{bodyEn || 'Message'}</p>
          </div>

          {!confirming && (
            <button
              disabled={!ready || pending}
              className="rounded-lg bg-cyan-800 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-900 disabled:opacity-50"
            >
              {pending ? 'Checking…' : 'Review & send'}
            </button>
          )}
        </form>

        {confirming && preview && (
          <div
            role="alertdialog"
            aria-labelledby="confirm-title"
            className="mt-4 rounded-lg border-2 border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950"
          >
            <p id="confirm-title" className="font-semibold">
              Send “{titleEn}” ({RISK_LABELS[level].en}) to {selected.join(', ')}?
            </p>
            <p className="mt-1">
              {preview.devices} device{preview.devices === 1 ? '' : 's'} in the area (
              {preview.withPush} by push, {preview.devices - preview.withPush} in-app). This can’t
              be undone.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await sendBroadcast({
                      districts: selected,
                      level,
                      titleEn,
                      titleMs,
                      bodyEn,
                      bodyMs,
                    });
                    setResult(res);
                    setConfirming(false);
                    if (res.ok) router.refresh();
                  })
                }
              >
                {pending ? 'Sending…' : 'Send now'}
              </button>
              <button
                className="rounded-lg border border-neutral-300 px-4 py-2 dark:border-neutral-700"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {result?.message && (
          <p
            role="status"
            className={`mt-3 text-sm ${result.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}
          >
            {result.message}
          </p>
        )}
      </Card>
    </div>
  );
}
