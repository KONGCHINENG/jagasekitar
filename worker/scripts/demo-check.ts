// Rehearse the demo without phones: runs each scenario at key moments against the real database
// (alerts off), prints the resulting zones, then turns demo mode off and cleans up.
// Run: npm run demo:check -w @jagasekitar/worker
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createServiceClient } from '../src/core/db';
import { endDemoIfNeeded, runDemoTick } from '../src/demo';
import type { DemoState, ScenarioId } from '../src/demo/scenarios';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const db = createServiceClient();
const startedAt = new Date().toISOString();

async function zoneSummary(hazard: string, at = new Date()): Promise<string> {
  const { data } = await db
    .from('hazard_zones')
    .select('zone_key, level, reason_en')
    .eq('hazard', hazard)
    .lte('valid_from', at.toISOString())
    .gt('valid_to', at.toISOString());
  const perak = (data ?? []).filter((z) =>
    /Kerian|Kuala Kangsar|Kinta|Manjung|Perak|haze/.test(`${z.zone_key} ${z.reason_en}`),
  );
  const order = ['severe', 'high', 'moderate', 'low'];
  perak.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  return perak
    .slice(0, 4)
    .map((z) => `    ${z.level.padEnd(8)} ${z.zone_key}\n             ${z.reason_en.slice(0, 150)}`)
    .join('\n');
}

async function step(scenario: ScenarioId, offset: number, hazard: string, at?: Date) {
  const state: DemoState = {
    enabled: true,
    scenario,
    speed: 1,
    started_at: startedAt,
    offset_minutes: offset,
  };
  await db.from('settings').update({ value: state }).eq('key', 'demo_mode');
  const res = await runDemoTick({ db, now: new Date(), state: 'PRK', useMocks: false }, state, {
    notify: false,
  });
  console.log(`\n▶ ${scenario} at demo +${offset} min`);
  for (const d of res?.detail ?? []) console.log(`  ${d}`);
  console.log(
    `  predictions: ${res?.predictions.map((p) => `${p.hazard} ${p.status} (${p.zones})`).join(', ')}`,
  );
  console.log(
    `  ${hazard} zones${at ? ' at +24h' : ''}:\n${(await zoneSummary(hazard, at)) || '    (none)'}`,
  );
}

try {
  await step('kerian_flood', 0, 'flood');
  await step('kerian_flood', 30, 'flood');
  await step('kerian_flood', 60, 'flood');
  await step('post_flood_disease', 30, 'disease');
  await step('riau_haze', 0, 'haze', new Date(Date.now() + 24 * 3600_000));
} finally {
  await db
    .from('settings')
    .update({
      value: { enabled: false, scenario: null, speed: 1, started_at: null, offset_minutes: 0 },
    })
    .eq('key', 'demo_mode');
  await endDemoIfNeeded({ db, now: new Date(), state: 'PRK', useMocks: false });
  const left = await Promise.all([
    db.from('fire_hotspots').select('*', { count: 'exact', head: true }).eq('source', 'demo'),
    db.from('rain_readings').select('*', { count: 'exact', head: true }).eq('raw->>demo', 'true'),
    db
      .from('case_reports')
      .select('*', { count: 'exact', head: true })
      .eq('notes', 'demo scenario'),
  ]);
  console.log(
    `\n■ demo off; demo rows left: hotspots ${left[0].count}, rain ${left[1].count}, reports ${left[2].count}`,
  );
  console.log('  live sources will refresh and predictions re-run on the next worker tick');
}
