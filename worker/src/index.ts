// JagaSekitar data worker.
//   npm run worker:once                       run every enabled source once, then exit
//   npm run worker:once -- --source=firms     run one source
//   npm run worker:dev                        keep running; each source refreshes on its own interval
//   npm run predict                           run the prediction engines only
// After any source writes data, the haze/flood/disease engines re-run.
// Intervals and enable flags come from data_source_status (editable in the admin panel).
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { firmsSource } from '../sources/firms';
import { glofasSource } from '../sources/glofas';
import { alertsSource, rainSource, waterLevelSource } from '../sources/infobanjir';
import { resolveStationCoords } from '../sources/infobanjir/stations';
import { metMalaysiaSource } from '../sources/metmalaysia';
import {
  openMeteoAirQualitySource,
  openMeteoLocalSource,
  openMeteoWindSource,
} from '../sources/open-meteo';
import { waqiSource } from '../sources/waqi';
import { createServiceClient, getSetting } from './core/db';
import { endDemoIfNeeded, runDemoTick } from './demo';
import type { DemoState } from './demo/scenarios';
import { runNotifications } from './notify';
import { runPredictions, type PredictionSummary } from './predict';
import { log } from './core/log';
import { runSource, type SourceContext, type SourceDef, type SourceRunResult } from './core/source';

// Load the repo-root .env so every workspace shares one file.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SOURCES: SourceDef<any>[] = [
  firmsSource,
  openMeteoWindSource,
  openMeteoAirQualitySource,
  openMeteoLocalSource,
  rainSource,
  waterLevelSource,
  alertsSource,
  metMalaysiaSource,
  // After the water-level source: it reads the gauges that source keeps up to date.
  glofasSource,
  waqiSource,
];
const INFOBANJIR = new Set([rainSource.name, waterLevelSource.name, alertsSource.name]);
// 30 s: demo scenarios advance every tick; live sources still run only when due.
const TICK_MS = 30_000;

const args = process.argv.slice(2);
const once = args.includes('--once');
const only = args.find((a) => a.startsWith('--source='))?.split('=')[1];
const predictOnly = args.includes('--predict');
const notifyOnly = args.includes('--notify');
// Skip alerts (e.g. when testing scenarios without pinging real phones).
const noNotify = args.includes('--no-notify');

interface SourceStatus {
  source: string;
  enabled: boolean;
  refresh_minutes: number;
  last_success_at: string | null;
  last_error_at: string | null;
  refresh_requested_at: string | null;
}

async function loadStatus(ctx: SourceContext): Promise<Map<string, SourceStatus>> {
  const { data, error } = await ctx.db
    .from('data_source_status')
    .select(
      'source, enabled, refresh_minutes, last_success_at, last_error_at, refresh_requested_at',
    );
  if (error) throw new Error(`data_source_status lookup failed: ${error.message}`);
  return new Map((data as SourceStatus[]).map((s) => [s.source, s]));
}

function isDue(s: SourceStatus | undefined, now: Date): boolean {
  if (!s) return true;
  const last = Math.max(
    Date.parse(s.last_success_at ?? '') || 0,
    Date.parse(s.last_error_at ?? '') || 0,
  );
  // "Refresh now" from the admin panel: run if requested since the last attempt.
  if (s.refresh_requested_at && Date.parse(s.refresh_requested_at) > last) return true;
  return now.getTime() - last >= s.refresh_minutes * 60_000;
}

/** "Re-run prediction" from the admin panel: requested after the latest prediction run started. */
async function predictionRequested(ctx: SourceContext): Promise<boolean> {
  const req = await getSetting<{ predict_at: string | null }>(ctx.db, 'worker_requests', {
    predict_at: null,
  });
  if (!req.predict_at) return false;
  const { data } = await ctx.db
    .from('prediction_runs')
    .select('started_at')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return !data || Date.parse(req.predict_at) > Date.parse(data.started_at);
}

interface TickResult {
  sources: SourceRunResult[];
  predictions: PredictionSummary[];
}

async function tick(force: boolean): Promise<TickResult> {
  const db = createServiceClient();
  const now = new Date();
  const ctx: SourceContext = {
    db,
    now,
    state: process.env.DEFAULT_STATE?.trim() || 'PRK',
    useMocks: process.env.USE_MOCKS?.trim().toLowerCase() === 'true',
  };

  const demo = await getSetting<DemoState>(db, 'demo_mode', {
    enabled: false,
    scenario: null,
    speed: 1,
    started_at: null,
    offset_minutes: 0,
  });
  if (demo.enabled) {
    // Live adapters pause; the scenario replays instead.
    const res = await runDemoTick(ctx, demo, { notify: !noNotify });
    return { sources: [], predictions: res?.predictions ?? [] };
  }
  await endDemoIfNeeded(ctx);
  if (notifyOnly) {
    await notifySafely(ctx);
    return { sources: [], predictions: [] };
  }
  if (predictOnly) {
    const predictions = await runPredictions(ctx);
    await notifySafely(ctx);
    return { sources: [], predictions };
  }

  const status = await loadStatus(ctx);
  const results: SourceRunResult[] = [];
  for (const source of SOURCES) {
    if (only && source.name !== only) continue;
    const s = status.get(source.name);
    if (s && !s.enabled) {
      if (force) log.info(source.name, 'disabled in admin settings, skipped');
      continue;
    }
    if (!force && !isDue(s, now)) continue;
    results.push(await runSource(source, ctx));
  }

  if (results.some((r) => INFOBANJIR.has(r.source))) {
    try {
      await resolveStationCoords(ctx);
    } catch (err) {
      log.error('stations', err instanceof Error ? err.message : String(err));
    }
  }
  // Re-predict whenever new data landed, or when an admin asked for it.
  const predictions =
    results.some((r) => r.written > 0) || (await predictionRequested(ctx))
      ? await runPredictions(ctx)
      : [];
  if (predictions.length) await notifySafely(ctx);
  return { sources: results, predictions };
}

/** Alert devices and saved places inside new or upgraded zones; never fails the tick. */
async function notifySafely(ctx: SourceContext): Promise<void> {
  try {
    await runNotifications(ctx);
  } catch (err) {
    log.error('notify', err instanceof Error ? err.message : String(err));
  }
}

function printSummary({ sources: results, predictions }: TickResult): void {
  if (predictions.length) {
    console.table(
      predictions.map((p) => ({
        hazard: p.hazard,
        status: p.status,
        zones: p.zones,
        ms: p.ms,
        error: p.error?.slice(0, 80) ?? '',
      })),
    );
  }
  if (!results.length) return;
  console.table(
    results.map((r) => ({
      source: r.source,
      status: r.ok ? 'ok' : 'FAILED',
      data: r.usedMock ? 'mock' : 'live',
      records: r.records,
      written: r.written,
      ms: r.ms,
      error: r.error?.slice(0, 80) ?? '',
    })),
  );
}

if (once) {
  const result = await tick(true);
  printSummary(result);
  // Exit non-zero only if data could not be written or an engine failed; mock fallbacks are expected.
  process.exitCode =
    result.sources.some((r) => r.written === 0 && r.records > 0) ||
    result.predictions.some((p) => p.status === 'failed')
      ? 1
      : 0;
} else {
  log.info('worker', `watching sources every ${TICK_MS / 1000}s (Ctrl+C to stop)`);
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      printSummary(await tick(false));
    } catch (err) {
      log.error('worker', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };
  await loop();
  setInterval(loop, TICK_MS);
}
