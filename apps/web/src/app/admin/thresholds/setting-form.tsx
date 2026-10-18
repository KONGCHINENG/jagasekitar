'use client';
// Renders a settings JSON value as a typed form. Numbers stay numbers, lists stay lists, risk
// levels get a dropdown; the server rejects any change to the shape.
import { RISK_LEVELS } from '@jagasekitar/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveSetting } from '../actions';

type Json = number | string | boolean | null | Json[] | { [k: string]: Json };

const LABELS: Record<string, string> = {
  cluster_radius_km: 'Hotspot cluster radius (km)',
  min_confidence: 'Minimum hotspot confidence (l / n / h)',
  trajectory_hours: 'Trajectory length (hours)',
  wind_blend_850: 'Weight of 850 hPa wind (0–1)',
  spread_kmh: 'Plume spread (km per hour of age)',
  max_half_width_km: 'Max plume half-width (km)',
  grid_km: 'Grid cell size (km)',
  time_slices_h: 'Time slices (hours ahead)',
  score_thresholds: 'Score thresholds per level',
  pm25_bands: 'PM2.5 band upper limits (µg/m³)',
  hourly_bands_mm: 'Hourly rain bands (mm/h, lower bounds)',
  severe_3h_mm: 'Severe: rain in 3 h above (mm), with a rising river',
  high_3h_mm: 'High: rain in 3 h above (mm)',
  high_forecast_24h_mm: 'High: 24 h forecast above (mm) …',
  high_cumulative_3d_mm: '… with 3-day total above (mm)',
  buffer_km: 'Zone radius per level (km)',
  official_alert_min_level: 'Minimum level for official JPS alerts',
  river_flow_levels: 'GloFAS: level when forecast flow reaches the 2 / 5 / 20-year flood flow',
  river_flow_min_rp2: 'GloFAS: ignore rivers whose 2-year flow is below (m³/s)',
  outbreak_min_count: 'Outbreak: minimum cases in 7 days',
  outbreak_ratio: 'Outbreak: ratio to baseline',
  flood_linked: 'Diseases raised by flooding (codes)',
  haze_linked: 'Diseases raised by haze (codes)',
  spike_warning_multiplier: 'Hospital form: warn above × usual',
  edit_window_hours: 'Hospital edits allowed for (hours)',
  dedupe_hours: "Don't repeat an alert within (hours)",
  batch_size: 'Push batch size',
  quiet_hours_bypass_level: 'Level that ignores quiet hours',
};

export function SettingForm({ settingKey, value }: { settingKey: string; value: Json }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Json>(value);
  const [msg, setMsg] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveSetting(settingKey, draft);
          setMsg(res);
          if (res.ok) router.refresh();
        });
      }}
    >
      <Field name={settingKey} value={draft} onChange={setDraft} root />
      <div className="flex items-center gap-3">
        <button
          disabled={!dirty || pending}
          className="rounded-lg bg-cyan-800 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-900 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {dirty && (
          <button
            type="button"
            className="text-sm text-neutral-600 hover:underline"
            onClick={() => setDraft(value)}
          >
            Reset
          </button>
        )}
        {msg?.message && (
          <span className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>
            {msg.message}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  name,
  value,
  onChange,
  root,
}: {
  name: string;
  value: Json;
  onChange: (v: Json) => void;
  root?: boolean;
}) {
  const label = LABELS[name] ?? name.replace(/_/g, ' ');
  const input =
    'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const body = (
      <div className={`grid gap-3 ${root ? 'sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {Object.entries(value).map(([k, v]) => (
          <Field key={k} name={k} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} />
        ))}
      </div>
    );
    return root ? (
      body
    ) : (
      <fieldset className="col-span-full rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <legend className="px-1 text-sm font-medium">{label}</legend>
        {body}
      </fieldset>
    );
  }
  if (Array.isArray(value)) {
    const numeric = typeof value[0] === 'number';
    return (
      <label className="col-span-full flex flex-col gap-1 text-sm">
        {label} <span className="text-xs text-neutral-500">(comma-separated)</span>
        <input
          className={input}
          defaultValue={value.join(', ')}
          onChange={(e) => {
            const parts = e.target.value
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean);
            onChange(numeric ? parts.map(Number) : parts.map((p) => p.toUpperCase()));
          }}
        />
      </label>
    );
  }
  if (typeof value === 'string' && (RISK_LEVELS as readonly string[]).includes(value)) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
          {RISK_LEVELS.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </label>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{' '}
        {label}
      </label>
    );
  }
  if (typeof value === 'number') {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <input
          type="number"
          step="any"
          min={0}
          className={input}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input className={input} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
