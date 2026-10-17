'use client';
import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { fastForwardDemo, setDemoMode } from '../actions';

export interface DemoState {
  enabled?: boolean;
  scenario?: 'riau_haze' | 'kerian_flood' | 'post_flood_disease' | null;
  speed?: number;
  started_at?: string | null;
  offset_minutes?: number;
}

const SCENARIOS = [
  {
    id: 'riau_haze',
    name: 'Riau fires → Perak haze',
    detail:
      '300 hotspots in Riau/Jambi; south-westerly winds carry smoke over Manjung, Perak Tengah and Kinta within 24–48 h.',
  },
  {
    id: 'kerian_flood',
    name: 'Monsoon flash flood: Kerian & Kuala Kangsar',
    detail:
      'Rain climbs past 60 mm in 3 h; rivers go Alert → Warning → Danger over about an hour of demo time.',
  },
  {
    id: 'post_flood_disease',
    name: 'Post-flood leptospirosis + dengue',
    detail: 'Hospital reports in Kerian and Kinta spike after the flood.',
  },
] as const;

export function DemoControls({ state }: { state: DemoState }) {
  const [scenario, setScenario] = useState<NonNullable<DemoState['scenario']>>(
    state.scenario ?? 'riau_haze',
  );
  const [speed, setSpeed] = useState(state.speed ?? 1);
  return (
    <div className="flex flex-col gap-5">
      <p
        className={`text-lg font-semibold ${state.enabled ? 'text-amber-700 dark:text-amber-400' : 'text-neutral-600'}`}
      >
        {state.enabled
          ? `◐ Demo mode is ON: ${SCENARIOS.find((s) => s.id === state.scenario)?.name ?? ''}`
          : '○ Demo mode is off (live data)'}
      </p>
      {state.enabled && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Demo clock: +{state.offset_minutes ?? 0} min · speed ×{state.speed ?? 1}
          {state.started_at &&
            ` · started ${new Date(state.started_at).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`}
        </p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Scenario</legend>
        {SCENARIOS.map((s) => (
          <label
            key={s.id}
            className="flex gap-3 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
          >
            <input
              type="radio"
              name="scenario"
              checked={scenario === s.id}
              onChange={() => setScenario(s.id)}
            />
            <span>
              <span className="font-medium">{s.name}</span>
              <span className="block text-neutral-600 dark:text-neutral-400">{s.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        Speed (demo minutes per real minute)
        <input
          type="number"
          min={1}
          max={120}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <ActionButton
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          action={() => setDemoMode({ enabled: true, scenario, speed })}
        >
          {state.enabled ? 'Apply / restart scenario' : 'Start demo mode'}
        </ActionButton>
        {state.enabled && (
          <>
            <ActionButton action={() => fastForwardDemo(30)}>⏩ +30 min</ActionButton>
            <ActionButton action={() => fastForwardDemo(180)}>⏩ +3 h</ActionButton>
            <ActionButton action={() => fastForwardDemo(720)}>⏩ +12 h</ActionButton>
            <ActionButton
              action={() =>
                setDemoMode({ enabled: false, scenario: state.scenario ?? null, speed })
              }
              confirm="Switch back to live data?"
            >
              Stop demo
            </ActionButton>
          </>
        )}
      </div>
      <div className="text-xs text-neutral-500">
        <p>
          While demo mode is on, the worker (<code>npm run worker:dev</code>) pauses live data and
          replays the scenario every 30 seconds: it advances the scenario, re-runs the predictions
          and sends alerts. Phones show a “Demo scenario running” notice.
        </p>
        <p className="mt-1">
          To move a phone into the action: in the app, Settings → tap the version 5 times → Simulate
          my location at… (Kerian or Kuala Kangsar for the flood, Manjung or Kinta for haze and
          illness). Stopping the demo removes every demo row and refreshes live data.
        </p>
      </div>
    </div>
  );
}
