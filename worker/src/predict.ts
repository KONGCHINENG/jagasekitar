// Prediction job: load engine inputs → run haze, flood, then disease → replace hazard_zones.
// Each hazard is logged in prediction_runs; one failing engine never blocks the others.
import {
  DEFAULT_DISEASE,
  DEFAULT_FLOOD,
  DEFAULT_HAZE,
  areaBbox,
  fromSettings,
  runDiseaseEngine,
  runFloodEngine,
  measuredHazeZones,
  runHazeEngine,
  type DiseaseSummaryInput,
  type District,
  type Hotspot,
  type OfficialAlertInput,
  type RiverFlowInput,
  type Pm25Sample,
  type PrecipSample,
  type RainStationInput,
  type WaterStationInput,
  type WindSample,
} from '@jagasekitar/engine';
import type { Hazard, HazardZone, RiskLevel } from '@jagasekitar/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from './core/log';
import type { SourceContext } from './core/source';

const HOUR = 3600_000;
const PAGE = 1000;

export interface PredictionSummary {
  hazard: Hazard;
  status: 'success' | 'failed';
  zones: number;
  ms: number;
  error?: string;
  stats?: unknown;
}

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

async function settingsRow(db: SupabaseClient, key: string): Promise<unknown> {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  return data?.value;
}

async function loadDistricts(db: SupabaseClient, state: string): Promise<District[]> {
  const { data, error } = await db
    .from('v_districts_geojson')
    .select('state, name, population, centroid_lat, centroid_lon, geometry')
    .eq('state', state);
  if (error) throw new Error(`districts: ${error.message}`);
  return (data ?? []).map((d) => ({
    state: d.state,
    name: d.name,
    population: d.population,
    centroid: { lat: d.centroid_lat, lon: d.centroid_lon },
    geometry: d.geometry,
  }));
}

/** In demo mode only the scenario's own fires count, so live FIRMS data can't change the script. */
async function loadHotspots(db: SupabaseClient, since: Date, demo: boolean): Promise<Hotspot[]> {
  const out: Hotspot[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from('fire_hotspots')
      .select('lat, lon, frp, confidence, acquired_at')
      .gte('acquired_at', since.toISOString());
    if (demo) query = query.eq('source', 'demo');
    const { data, error } = await query.order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`fire_hotspots: ${error.message}`);
    for (const h of data ?? []) {
      out.push({
        lat: h.lat,
        lon: h.lon,
        frp: h.frp,
        confidence: h.confidence,
        acquiredAt: h.acquired_at,
      });
    }
    if (!data || data.length < PAGE) return out;
  }
}

/** Zones the app has right now (used for disease ↔ hazard linkage). */
async function loadActiveZones(db: SupabaseClient): Promise<HazardZone[]> {
  const { data, error } = await db
    .from('v_active_zones')
    .select(
      'zone_key, hazard, level, geometry, valid_from, valid_to, confidence, reason_en, source_refs',
    )
    .in('hazard', ['flood', 'haze']);
  if (error) throw new Error(`v_active_zones: ${error.message}`);
  return (data ?? []).map((z) => ({
    id: z.zone_key ?? '',
    hazard: z.hazard,
    level: z.level as RiskLevel,
    geometry: z.geometry,
    validFrom: z.valid_from,
    validTo: z.valid_to,
    confidence: z.confidence,
    reason: z.reason_en,
    sourceRefs: z.source_refs,
  }));
}

async function writeZones(
  db: SupabaseClient,
  hazard: Hazard,
  runId: string,
  zones: HazardZone[],
): Promise<number> {
  const payload = zones.map((z) => {
    const [, district, code] = z.id.split(':');
    return {
      ...z,
      district: z.hazard === 'flood' || z.hazard === 'disease' ? district : null,
      diseaseCode: z.hazard === 'disease' ? code : null,
    };
  });
  return rpc<number>(db, 'replace_hazard_zones', {
    p_hazard: hazard,
    p_run_id: runId,
    p_zones: payload,
  });
}

async function withRun(
  ctx: SourceContext,
  demo: boolean,
  hazard: Hazard,
  run: (runId: string) => Promise<{ zones: number; stats: unknown }>,
): Promise<PredictionSummary> {
  const started = Date.now();
  const { data, error } = await ctx.db
    .from('prediction_runs')
    .insert({ hazard, status: 'running', demo })
    .select('id')
    .single();
  if (error) throw new Error(`prediction_runs insert: ${error.message}`);
  const runId = data.id as string;
  try {
    const { zones, stats } = await run(runId);
    await ctx.db
      .from('prediction_runs')
      .update({
        status: 'success',
        finished_at: new Date().toISOString(),
        stats: { ...(stats as object), zones },
      })
      .eq('id', runId);
    const ms = Date.now() - started;
    log.info(`predict:${hazard}`, `${zones} zones in ${ms} ms`);
    return { hazard, status: 'success', zones, ms, stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db
      .from('prediction_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: message.slice(0, 1000),
      })
      .eq('id', runId);
    log.error(`predict:${hazard}`, message);
    return { hazard, status: 'failed', zones: 0, ms: Date.now() - started, error: message };
  }
}

export async function runPredictions(
  ctx: SourceContext,
  opts: { demo?: boolean } = {},
): Promise<PredictionSummary[]> {
  const demo = opts.demo ?? false;
  const { db, now, state } = ctx;
  const districts = await loadDistricts(db, state);
  const places = districts.map((d) => ({ name: d.name, lat: d.centroid.lat, lon: d.centroid.lon }));
  const results: PredictionSummary[] = [];

  results.push(
    await withRun(ctx, demo, 'haze', async (runId) => {
      const config = fromSettings(DEFAULT_HAZE, await settingsRow(db, 'haze'));
      const from = new Date(now.getTime() - 3 * HOUR).toISOString();
      const to = new Date(now.getTime() + (config.trajectoryHours + 3) * HOUR).toISOString();
      const [hotspots, wind, pm25, measuredRes] = await Promise.all([
        loadHotspots(db, new Date(now.getTime() - 48 * HOUR), demo),
        rpc<WindSample[]>(db, 'engine_weather', {
          p_kind: 'wind',
          p_from: from,
          p_to: to,
          p_step_hours: 3,
        }),
        rpc<Pm25Sample[]>(db, 'engine_weather', {
          p_kind: 'pm25',
          p_from: from,
          p_to: to,
          p_step_hours: 3,
        }),
        // Live official monitors only: sample readings and community sensors never create zones.
        db
          .from('v_air_quality_latest')
          .select('name, lat, lon, pm25, observed_at')
          .eq('simulated', false)
          .eq('official', true)
          .not('pm25', 'is', null)
          .gt('observed_at', new Date(now.getTime() - 3 * HOUR).toISOString()),
      ]);
      if (measuredRes.error) throw new Error(`v_air_quality_latest: ${measuredRes.error.message}`);
      const result = runHazeEngine({ now, hotspots, wind, pm25, places, config });
      // Demo scenarios stay reproducible: no live measurements mixed in.
      const measured = demo
        ? []
        : measuredHazeZones(
            (measuredRes.data ?? []).map((o) => ({
              name: o.name,
              lat: o.lat,
              lon: o.lon,
              pm25: o.pm25,
              observedAt: o.observed_at,
            })),
            now,
            { bands: config.pm25Bands },
          );
      const zones = await writeZones(db, 'haze', runId, [...result.zones, ...measured]);
      return {
        zones,
        stats: { ...result.stats, windSamples: wind.length, pm25Samples: pm25.length },
      };
    }),
  );

  results.push(
    await withRun(ctx, demo, 'flood', async (runId) => {
      const config = fromSettings(DEFAULT_FLOOD, await settingsRow(db, 'flood'));
      // Forecast grid limited to the state (plus a margin) for speed.
      const boxes = districts.filter((d) => d.geometry).map((d) => areaBbox(d.geometry!));
      const bbox = boxes.length
        ? [
            Math.min(...boxes.map((b) => b[0])) - 0.3,
            Math.min(...boxes.map((b) => b[1])) - 0.3,
            Math.max(...boxes.map((b) => b[2])) + 0.3,
            Math.max(...boxes.map((b) => b[3])) + 0.3,
          ]
        : null;
      const [rain, water, forecast, alertsRes, flowRes] = await Promise.all([
        rpc<RainStationInput[]>(db, 'engine_rain_latest', { p_state: state }),
        rpc<WaterStationInput[]>(db, 'engine_water_latest', { p_state: state }),
        rpc<PrecipSample[]>(db, 'engine_weather', {
          p_kind: 'precip',
          p_from: new Date(now.getTime() - HOUR).toISOString(),
          p_to: new Date(now.getTime() + 25 * HOUR).toISOString(),
          p_step_hours: 1,
          p_bbox: bbox,
        }),
        db
          .from('official_alerts')
          .select('source, station_id, title, level, district, raw')
          .gt('expires_at', now.toISOString()),
        // GloFAS forecasts fetched in the last 2 days (it updates daily).
        db
          .from('river_flow_forecasts')
          .select('station_id, peak, peak_date, rp2, rp5, rp20, exceeded')
          .gt('fetched_at', new Date(now.getTime() - 48 * HOUR).toISOString()),
      ]);
      if (alertsRes.error) throw new Error(`official_alerts: ${alertsRes.error.message}`);
      if (flowRes.error) throw new Error(`river_flow_forecasts: ${flowRes.error.message}`);
      const alerts: OfficialAlertInput[] = (alertsRes.data ?? [])
        .filter((a) => !demo || a.source !== 'metmalaysia')
        .map((a) => ({
          source: a.source,
          stationId: a.station_id,
          title: a.title,
          titleMs: (a.raw as { title_ms?: string } | null)?.title_ms,
          level: a.level,
          district: a.district,
          lat: (a.raw as { lat?: number } | null)?.lat ?? null,
          lon: (a.raw as { lon?: number } | null)?.lon ?? null,
        }));
      // Demo scenarios stay reproducible: no live GloFAS forecasts or MetMalaysia warnings.
      const riverFlow: RiverFlowInput[] = (demo ? [] : (flowRes.data ?? [])).map((r) => ({
        stationId: r.station_id,
        peak: r.peak,
        peakDate: r.peak_date,
        rp2: r.rp2,
        rp5: r.rp5,
        rp20: r.rp20,
        exceeded: r.exceeded,
      }));
      const result = runFloodEngine({
        now,
        rain,
        water,
        forecast,
        alerts,
        riverFlow,
        districts,
        config,
      });
      const zones = await writeZones(db, 'flood', runId, result.zones);
      return {
        zones,
        stats: {
          ...result.stats,
          alerts: alerts.length,
          riverForecasts: riverFlow.length,
          forecastSamples: forecast.length,
        },
      };
    }),
  );

  results.push(
    await withRun(ctx, demo, 'disease', async (runId) => {
      const config = fromSettings(DEFAULT_DISEASE, await settingsRow(db, 'disease'));
      const [summaryRes, typesRes, hazardZones] = await Promise.all([
        db
          .from('v_disease_district_summary')
          .select(
            'state, district, disease_code, disease_name_en, disease_name_ms, cases_7d, cases_prev_28d, population',
          )
          .eq('state', state),
        db.from('disease_types').select('code, name_en, name_ms').eq('active', true),
        loadActiveZones(db),
      ]);
      if (summaryRes.error) throw new Error(`disease summary: ${summaryRes.error.message}`);
      if (typesRes.error) throw new Error(`disease_types: ${typesRes.error.message}`);
      const summaries: DiseaseSummaryInput[] = (summaryRes.data ?? []).map((s) => ({
        state: s.state,
        district: s.district,
        diseaseCode: s.disease_code,
        diseaseNameEn: s.disease_name_en,
        diseaseNameMs: s.disease_name_ms,
        cases7d: s.cases_7d,
        casesPrev28d: s.cases_prev_28d,
        population: s.population,
      }));
      const diseaseNames = Object.fromEntries(
        (typesRes.data ?? []).map((t) => [t.code, { en: t.name_en, ms: t.name_ms }]),
      );
      const result = runDiseaseEngine({
        now,
        summaries,
        districts,
        hazardZones,
        diseaseNames,
        config,
      });
      const zones = await writeZones(db, 'disease', runId, result.zones);
      return {
        zones,
        stats: {
          summaries: summaries.length,
          linkedZones: hazardZones.length,
          outbreaks: result.assessments.filter((a) => a.outbreak).length,
        },
      };
    }),
  );
  return results;
}
