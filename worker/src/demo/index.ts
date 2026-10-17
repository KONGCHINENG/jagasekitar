// Demo mode runtime: replays a scenario instead of live data, every worker tick (30 s).
// All demo rows are tagged (fire source 'demo', readings raw.demo = true, case-report notes) so
// stopping the demo removes exactly what it added; live adapters then refresh everything else.
import { upsertChunks } from '../core/db';
import { log } from '../core/log';
import type { SourceContext } from '../core/source';
import { runNotifications } from '../notify';
import { runPredictions, type PredictionSummary } from '../predict';
import {
  demoMinutes,
  diseaseReports,
  hazeHotspots,
  hazeWeather,
  interpolate,
  levelForStage,
  loadScenario,
  statusForLevel,
  type DemoState,
  type DiseaseScenario,
  type FloodScenario,
  type HazeScenario,
  type ScenarioId,
} from './scenarios';

const RUNTIME_KEY = 'demo_runtime';

interface Runtime {
  scenario: ScenarioId | null;
  started_at: string | null;
}

async function getRuntime(ctx: SourceContext): Promise<Runtime | null> {
  const { data } = await ctx.db
    .from('settings')
    .select('value')
    .eq('key', RUNTIME_KEY)
    .maybeSingle();
  return (data?.value as Runtime | undefined) ?? null;
}

async function setRuntime(ctx: SourceContext, value: Runtime | null): Promise<void> {
  if (value) {
    await ctx.db
      .from('settings')
      .upsert({
        key: RUNTIME_KEY,
        value,
        description: 'Worker bookkeeping for the running demo scenario',
      });
  } else {
    await ctx.db.from('settings').delete().eq('key', RUNTIME_KEY);
  }
}

async function must(p: PromiseLike<{ error: { message: string } | null }>, what: string) {
  const { error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Remove everything a demo scenario wrote. */
export async function cleanupDemoData(ctx: SourceContext): Promise<void> {
  const disease = loadScenario<DiseaseScenario>('post_flood_disease');
  await must(ctx.db.from('fire_hotspots').delete().eq('source', 'demo'), 'demo hotspots cleanup');
  await must(ctx.db.from('rain_readings').delete().eq('raw->>demo', 'true'), 'demo rain cleanup');
  await must(
    ctx.db.from('water_level_readings').delete().eq('raw->>demo', 'true'),
    'demo water cleanup',
  );
  await must(
    ctx.db.from('case_reports').delete().eq('notes', disease.note).is('submitted_by', null),
    'demo reports cleanup',
  );
}

/** After a demo: ask the worker to refresh every live source and re-predict on the next tick. */
async function requestLiveRefresh(ctx: SourceContext): Promise<void> {
  const now = new Date().toISOString();
  await ctx.db.from('data_source_status').update({ refresh_requested_at: now }).neq('source', '');
  await ctx.db
    .from('settings')
    .update({ value: { predict_at: now } })
    .eq('key', 'worker_requests');
}

async function seedHaze(ctx: SourceContext): Promise<void> {
  const def = loadScenario<HazeScenario>('riau_haze');
  // Live mock fires would muddy the story; live data restores them after the demo.
  await must(ctx.db.from('fire_hotspots').delete().eq('source', 'mock'), 'mock hotspots cleanup');
  await upsertChunks(
    ctx.db,
    'fire_hotspots',
    hazeHotspots(def, ctx.now),
    'source,lat,lon,acquired_at',
    { ignoreDuplicates: true },
  );
  const { wind, pm } = hazeWeather(def, ctx.now);
  await upsertChunks(ctx.db, 'weather_grid', wind, 'lat,lon,valid_at');
  await upsertChunks(ctx.db, 'weather_grid', pm, 'lat,lon,valid_at');
}

async function applyFlood(ctx: SourceContext, minutes: number): Promise<string> {
  const def = loadScenario<FloodScenario>('kerian_flood');
  const frame = interpolate(def.keyframes, minutes);
  const before = interpolate(def.keyframes, Math.max(0, minutes - 5));
  const observedAt = new Date(Math.floor(ctx.now.getTime() / 60_000) * 60_000).toISOString();

  await upsertChunks(
    ctx.db,
    'rain_readings',
    def.stations.rain.map((id) => ({
      station_id: id,
      observed_at: observedAt,
      rain_1h: frame.rain1h,
      rain_3h: frame.rain3h,
      rain_6h: frame.rain3h + 4,
      rain_24h: frame.rain24h,
      rain_72h: frame.rain72h,
      rain_since_midnight: frame.rain24h,
      raw: { demo: true },
    })),
    'station_id,observed_at',
  );

  const { data: stations, error } = await ctx.db
    .from('water_level_stations')
    .select('station_id, normal_level, alert_level, warning_level, danger_level')
    .in('station_id', def.stations.water);
  if (error) throw new Error(`demo water stations: ${error.message}`);
  const trend =
    frame.waterStage > before.waterStage + 0.01
      ? 'rising'
      : frame.waterStage < before.waterStage - 0.01
        ? 'falling'
        : 'steady';
  const rows = (stations ?? []).flatMap((s) => {
    const level = levelForStage(s, frame.waterStage);
    return level == null
      ? []
      : [
          {
            station_id: s.station_id,
            observed_at: observedAt,
            level,
            status: statusForLevel(s, level),
            trend,
            raw: { demo: true },
          },
        ];
  });
  await upsertChunks(ctx.db, 'water_level_readings', rows, 'station_id,observed_at');
  return `flood t=${minutes.toFixed(0)} min: ${frame.rain3h} mm/3h, water stage ${frame.waterStage.toFixed(2)} (${rows[0]?.status ?? 'n/a'})`;
}

async function applyDisease(ctx: SourceContext, minutes: number): Promise<string> {
  const def = loadScenario<DiseaseScenario>('post_flood_disease');
  const { data: facilities, error } = await ctx.db
    .from('facilities')
    .select('id, name')
    .in('name', def.facilities);
  if (error) throw new Error(`demo facilities: ${error.message}`);
  const ids = (facilities ?? []).map((f) => f.id as string);
  const progress = Math.min(1, minutes / def.rampMinutes);
  const today = new Date(ctx.now.getTime() + 8 * 3600_000).toISOString().slice(0, 10); // Malaysia date
  await must(
    ctx.db
      .from('case_reports')
      .delete()
      .eq('notes', def.note)
      .is('submitted_by', null)
      .in('facility_id', ids),
    'demo reports reset',
  );
  const rows = ids.flatMap((id) => diseaseReports(def, id, today, progress));
  // ignoreDuplicates: never overwrite a real report that happens to share facility/disease/date.
  await upsertChunks(ctx.db, 'case_reports', rows, 'facility_id,disease_code,report_date', {
    ignoreDuplicates: true,
  });
  return `disease ramp ${(progress * 100).toFixed(0)}% (${rows.length} rows across ${ids.length} facilities)`;
}

export interface DemoTickResult {
  scenario: ScenarioId;
  minutes: number;
  detail: string[];
  predictions: PredictionSummary[];
}

/** One demo tick: (re)seed on scenario change, advance the scenario, predict, notify. */
export async function runDemoTick(
  ctx: SourceContext,
  state: DemoState,
  opts: { notify?: boolean } = {},
): Promise<DemoTickResult | null> {
  if (!state.scenario) return null;
  const runtime = await getRuntime(ctx);
  if (!runtime || runtime.scenario !== state.scenario || runtime.started_at !== state.started_at) {
    log.info('demo', `starting scenario ${state.scenario}`);
    await cleanupDemoData(ctx);
    if (state.scenario === 'riau_haze') await seedHaze(ctx);
    await setRuntime(ctx, { scenario: state.scenario, started_at: state.started_at });
  }

  const minutes = demoMinutes(state, ctx.now);
  const detail: string[] = [];
  if (state.scenario === 'riau_haze')
    detail.push(
      'haze: 300 hotspots seeded; wind turns south-south-westerly 6 h in, PM2.5 plume over Perak',
    );
  if (state.scenario === 'kerian_flood') detail.push(await applyFlood(ctx, minutes));
  if (state.scenario === 'post_flood_disease') {
    const def = loadScenario<DiseaseScenario>('post_flood_disease');
    detail.push(await applyFlood(ctx, def.floodAtMinute));
    detail.push(await applyDisease(ctx, minutes));
  }
  for (const d of detail) log.info('demo', d);

  const predictions = await runPredictions(ctx, { demo: true });
  if (opts.notify !== false) {
    try {
      await runNotifications(ctx);
    } catch (err) {
      log.error('notify', err instanceof Error ? err.message : String(err));
    }
  }
  return { scenario: state.scenario, minutes, detail, predictions };
}

/** Demo switched off: remove demo rows once and hand back to live data. */
export async function endDemoIfNeeded(ctx: SourceContext): Promise<boolean> {
  const runtime = await getRuntime(ctx);
  if (!runtime) return false;
  log.info(
    'demo',
    `stopping scenario ${runtime.scenario}: removing demo data, refreshing live sources`,
  );
  await cleanupDemoData(ctx);
  await setRuntime(ctx, null);
  await requestLiveRefresh(ctx);
  return true;
}
