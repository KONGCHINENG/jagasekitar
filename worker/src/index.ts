// JagaSekitar data worker.
//   npm run worker:once                       run every enabled source once, then exit
//   npm run worker:once -- --source=firms     run one source
//   npm run worker:dev                        keep running; each source refreshes on its own interval
// Intervals and enable flags come from data_source_status (editable in the admin panel).
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { firmsSource } from '../sources/firms';
import { alertsSource, rainSource, waterLevelSource } from '../sources/infobanjir';
import { resolveStationCoords } from '../sources/infobanjir/stations';
import {
  openMeteoAirQualitySource,
  openMeteoLocalSource,
  openMeteoWindSource,
} from '../sources/open-meteo';
import { createServiceClient, getSetting } from './core/db';
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
];
const INFOBANJIR = new Set([rainSource.name, waterLevelSource.name, alertsSource.name]);
const TICK_MS = 60_000;

const args = process.argv.slice(2);
const once = args.includes('--once');
const only = args.find((a) => a.startsWith('--source='))?.split('=')[1];

interface SourceStatus {
  source: string;
  enabled: boolean;
  refresh_minutes: number;
  last_success_at: string | null;
  last_error_at: string | null;
}

async function loadStatus(ctx: SourceContext): Promise<Map<string, SourceStatus>> {
  const { data, error } = await ctx.db
    .from('data_source_status')
    .select('source, enabled, refresh_minutes, last_success_at, last_error_at');
  if (error) throw new Error(`data_source_status lookup failed: ${error.message}`);
  return new Map((data as SourceStatus[]).map((s) => [s.source, s]));
}

function isDue(s: SourceStatus | undefined, now: Date): boolean {
  if (!s) return true;
  const last = Math.max(
    Date.parse(s.last_success_at ?? '') || 0,
    Date.parse(s.last_error_at ?? '') || 0,
  );
  return now.getTime() - last >= s.refresh_minutes * 60_000;
}

async function tick(force: boolean): Promise<SourceRunResult[]> {
  const db = createServiceClient();
  const now = new Date();
  const ctx: SourceContext = {
    db,
    now,
    state: process.env.DEFAULT_STATE?.trim() || 'PRK',
    useMocks: process.env.USE_MOCKS?.trim().toLowerCase() === 'true',
  };

  const demo = await getSetting(db, 'demo_mode', { enabled: false });
  if (demo.enabled) {
    log.info(
      'worker',
      'demo mode is on: live adapters paused (scenario replay arrives in Phase 9)',
    );
    return [];
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
  return results;
}

function printSummary(results: SourceRunResult[]): void {
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
  const results = await tick(true);
  printSummary(results);
  // Exit non-zero only if something could not be written; mock fallbacks are expected.
  process.exitCode = results.some((r) => r.written === 0 && r.records > 0) ? 1 : 0;
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
