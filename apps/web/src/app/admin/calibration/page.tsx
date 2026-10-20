import { Suspense } from 'react';
import { ActionButton } from '@/components/action-button';
import { Card, PageTitle, Skeleton } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { applyCalibration, deleteFloodEvent, setFloodEventVerified } from '../actions';
import { AddEventForm } from './add-event-form';

export const metadata = { title: 'Calibration · Admin' };

interface Metrics {
  hits: number;
  misses: number;
  falseAlarms: number;
  csi: number;
  pod: number;
  far: number;
  meanLeadDays: number | null;
}
interface ParamSet {
  params: { highForecast24hMm: number; highCumulative3dMm: number };
  metrics: Metrics;
}
interface Run {
  id: string;
  created_at: string;
  period_from: string;
  period_to: string;
  events_used: number;
  district_days: number;
  current: ParamSet;
  suggested: ParamSet;
  details: {
    include_drafts?: boolean;
    top?: ParamSet[];
    glofas_truth?: { events: number; current: Metrics; suggested_on_glofas: Metrics | null };
    caveats?: string[];
  };
  applied_at: string | null;
}

const primary =
  'rounded-md bg-cyan-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-900 disabled:opacity-50';
const small =
  'rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900';
const pct = (x: number) => `${Math.round(x * 100)}%`;
const myt = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });

export default function CalibrationPage() {
  return (
    <>
      <PageTitle sub="Replay past years through the flood rain rule, score it against real past floods, and apply better thresholds. Nothing changes until you click Apply.">
        Calibration (flood)
      </PageTitle>
      <Suspense fallback={<Skeleton h="h-[600px]" />}>
        <CalibrationBody />
      </Suspense>
    </>
  );
}

async function CalibrationBody() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: runs }, { data: events }, { data: districts }] = await Promise.all([
    supabase
      .from('calibration_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('flood_events')
      .select('id, district, start_date, end_date, description, source_url, verified')
      .order('start_date', { ascending: false }),
    supabase.from('districts').select('name').order('name'),
  ]);
  const latest = (runs?.[0] ?? null) as Run | null;
  const verifiedCount = (events ?? []).filter((e) => e.verified).length;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Latest run">
        {latest ? <RunSummary run={latest} /> : <p className="text-sm">No runs yet.</p>}
        <p className="mt-4 text-xs text-neutral-500">
          Run a new calibration on the laptop: <code>npm run calibrate</code> (verified events only)
          or <code>cd worker && npx tsx scripts/calibrate.ts --include-drafts</code>. It takes a
          minute the first time (downloads rain and river history), then seconds.
        </p>
      </Card>

      <Card title={`Past flood events (${verifiedCount} verified of ${events?.length ?? 0})`}>
        <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
          Only <strong>verified</strong> events are used. Check each source, fix the dates or
          districts if needed (delete and re-add), then click Verify.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-600 dark:text-neutral-400">
              <tr>
                <th className="pb-2 font-medium">District</th>
                <th className="pb-2 font-medium">Dates</th>
                <th className="pb-2 font-medium">What happened</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {(events ?? []).map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-neutral-100 align-top dark:border-neutral-900"
                >
                  <td className="py-2 pr-3 whitespace-nowrap">{e.district}</td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                    {e.start_date}
                    {e.end_date !== e.start_date ? ` → ${e.end_date}` : ''}
                  </td>
                  <td className="py-2 pr-3">
                    {e.description}
                    {e.source_url && (
                      <>
                        {' '}
                        <a
                          href={e.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-800 underline dark:text-cyan-300"
                        >
                          source
                        </a>
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {e.verified ? (
                      <span className="text-green-700 dark:text-green-400">✓ Verified</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">Draft</span>
                    )}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <span className="flex gap-2">
                      <ActionButton
                        className={small}
                        action={() => setFloodEventVerified(e.id, !e.verified)}
                      >
                        {e.verified ? 'Unverify' : 'Verify'}
                      </ActionButton>
                      <ActionButton
                        className={small}
                        confirm="Delete this event?"
                        action={() => deleteFloodEvent(e.id)}
                      >
                        Delete
                      </ActionButton>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Add a past flood">
        <AddEventForm districts={(districts ?? []).map((d) => d.name)} />
      </Card>
    </div>
  );
}

function RunSummary({ run }: { run: Run }) {
  const rows = [
    { label: 'Current', set: run.current },
    { label: 'Suggested', set: run.suggested },
  ];
  const same =
    run.current.params.highForecast24hMm === run.suggested.params.highForecast24hMm &&
    run.current.params.highCumulative3dMm === run.suggested.params.highCumulative3dMm;
  const g = run.details.glofas_truth;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        {myt(run.created_at)} · replayed {run.period_from} → {run.period_to} (
        {run.district_days.toLocaleString()} district-days) against{' '}
        <strong>{run.events_used} events</strong>
        {run.details.include_drafts && (
          <span className="text-amber-700 dark:text-amber-400">
            {' '}
            (including unverified drafts: verify events and re-run before applying)
          </span>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-left text-neutral-600 dark:text-neutral-400">
            <tr>
              <th className="pb-2 font-medium" />
              <th className="pb-2 font-medium">Forecast 24 h &gt;</th>
              <th className="pb-2 font-medium">Past 3 days &gt;</th>
              <th className="pb-2 font-medium">Caught</th>
              <th className="pb-2 font-medium">False alarms</th>
              <th className="pb-2 font-medium">Skill (CSI)</th>
              <th className="pb-2 font-medium">Warning</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map(({ label, set }) => (
              <tr key={label} className="border-t border-neutral-100 dark:border-neutral-900">
                <td className="py-2 pr-3 font-medium">{label}</td>
                <td className="py-2 pr-3">{set.params.highForecast24hMm} mm</td>
                <td className="py-2 pr-3">{set.params.highCumulative3dMm} mm</td>
                <td className="py-2 pr-3">
                  {set.metrics.hits} of {set.metrics.hits + set.metrics.misses} (
                  {pct(set.metrics.pod)})
                </td>
                <td className="py-2 pr-3">
                  {set.metrics.falseAlarms} ({pct(set.metrics.far)})
                </td>
                <td className="py-2 pr-3">{set.metrics.csi.toFixed(2)}</td>
                <td className="py-2 pr-3">
                  {set.metrics.meanLeadDays == null
                    ? '–'
                    : `${set.metrics.meanLeadDays.toFixed(1)} days ahead`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {g && (
        <p className="text-neutral-600 dark:text-neutral-400">
          Second check, GloFAS river flow above its 5-year level ({g.events} episodes): current
          catches {g.current.hits}, suggested catches {g.suggested_on_glofas?.hits ?? '–'}.
        </p>
      )}
      {run.details.caveats?.length ? (
        <ul className="list-disc pl-5 text-xs text-neutral-500">
          {run.details.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {run.applied_at ? (
          <span className="text-green-700 dark:text-green-400">
            ✓ Applied {myt(run.applied_at)}
          </span>
        ) : same ? (
          <span className="text-neutral-600">
            The current thresholds are already the best found.
          </span>
        ) : (
          <ActionButton
            className={primary}
            confirm={`Set flood thresholds to forecast > ${run.suggested.params.highForecast24hMm} mm and past 3 days > ${run.suggested.params.highCumulative3dMm} mm?`}
            action={() => applyCalibration(run.id)}
          >
            Apply suggested thresholds
          </ActionButton>
        )}
        <span className="text-xs text-neutral-500">
          Changes go to Thresholds → flood and the audit log; you can change them back there.
        </span>
      </div>
    </div>
  );
}
