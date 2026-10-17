import { describe, expect, it } from 'vitest';
import {
  demoMinutes,
  diseaseReports,
  hazeHotspots,
  hazeWeather,
  interpolate,
  levelForStage,
  loadScenario,
  statusForLevel,
  type DiseaseScenario,
  type FloodScenario,
  type HazeScenario,
} from './scenarios';

const NOW = new Date('2026-10-17T06:00:00Z');

describe('demo clock', () => {
  it('combines elapsed time, speed and fast-forward', () => {
    const state = {
      enabled: true,
      scenario: 'kerian_flood' as const,
      speed: 4,
      started_at: '2026-10-17T05:50:00Z',
      offset_minutes: 30,
    };
    expect(demoMinutes(state, NOW)).toBe(10 * 4 + 30);
    expect(demoMinutes({ ...state, started_at: null, offset_minutes: 0 }, NOW)).toBe(0);
  });
});

describe('flood scenario', () => {
  const def = loadScenario<FloodScenario>('kerian_flood');

  it('interpolates keyframes and clamps at the ends', () => {
    expect(interpolate(def.keyframes, 7.5).rain3h).toBe(26);
    expect(interpolate(def.keyframes, -5).waterStage).toBe(0.5);
    expect(interpolate(def.keyframes, 999).waterStage).toBe(3.2);
  });

  it('passes the engine thresholds in order: >60 mm in 3 h by 30 min, Danger by 60 min', () => {
    expect(interpolate(def.keyframes, 30).rain3h).toBeGreaterThan(60);
    const t = { normal_level: 17.4, alert_level: 19.5, warning_level: 19.8, danger_level: 20 };
    expect(statusForLevel(t, levelForStage(t, interpolate(def.keyframes, 15).waterStage)!)).toBe(
      'alert',
    );
    expect(statusForLevel(t, levelForStage(t, interpolate(def.keyframes, 45).waterStage)!)).toBe(
      'warning',
    );
    expect(statusForLevel(t, levelForStage(t, interpolate(def.keyframes, 60).waterStage)!)).toBe(
      'danger',
    );
  });

  it('needs all four thresholds to place a level', () => {
    expect(
      levelForStage({ normal_level: 1, alert_level: null, warning_level: 3, danger_level: 4 }, 1),
    ).toBeNull();
  });
});

describe('haze scenario', () => {
  const def = loadScenario<HazeScenario>('riau_haze');

  it('generates ~300 deterministic hotspots in Sumatra', () => {
    const a = hazeHotspots(def, NOW);
    expect(a).toHaveLength(300);
    expect(hazeHotspots(def, NOW)).toEqual(a);
    expect(a.every((h) => h.lat < 2.5 && h.lon > 100 && h.source === 'demo')).toBe(true);
  });

  it('turns the wind from north-easterly to south-south-westerly, with a PM2.5 plume over Perak', () => {
    const { wind, pm } = hazeWeather(def, NOW);
    expect(wind.length).toBe(27 * 15 * 26);
    const dir = (iso: string) =>
      wind.filter((w) => w.valid_at === iso).map((w) => w.wind_dir_850 as number);
    expect(dir('2026-10-17T06:00:00.000Z').every((d) => d > 40 && d < 70)).toBe(true);
    expect(dir('2026-10-18T06:00:00.000Z').every((d) => d > 180 && d < 205)).toBe(true);
    const later = pm.filter((p) => p.valid_at === '2026-10-18T06:00:00.000Z');
    const overPerak = later.find((p) => p.lat === 4.5 && p.lon === 101)!;
    const farAway = later.find((p) => p.lat === 1.5 && p.lon === 104)!;
    expect(overPerak.pm2_5 as number).toBeGreaterThan(55);
    expect(farAway.pm2_5 as number).toBeLessThan(25);
  });
});

describe('disease scenario', () => {
  const def = loadScenario<DiseaseScenario>('post_flood_disease');

  it('builds a quiet baseline and a last week that grows with progress', () => {
    const none = diseaseReports(def, 'f1', '2026-10-17', 0);
    const full = diseaseReports(def, 'f1', '2026-10-17', 1);
    const lastWeek = (rows: typeof full) =>
      rows.filter((r) => r.report_date >= '2026-10-11').reduce((a, r) => a + r.new_cases, 0);
    expect(lastWeek(none)).toBe(0);
    expect(lastWeek(full)).toBe(24 + 30);
    expect(full.filter((r) => r.report_date < '2026-10-10').length).toBe(4 * (1 + 3));
    expect(new Set(full.map((r) => `${r.disease_code}|${r.report_date}`)).size).toBe(full.length); // no duplicate keys
  });
});
