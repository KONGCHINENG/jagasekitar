// Every source must have a working mock fallback whose times look current (demo-day safety).
import { describe, expect, it } from 'vitest';
import { firmsSource } from '../sources/firms';
import { alertsSource, rainSource, waterLevelSource } from '../sources/infobanjir';
import {
  openMeteoAirQualitySource,
  openMeteoLocalSource,
  openMeteoWindSource,
} from '../sources/open-meteo';
import { rebaseTimes, type SourceContext } from './core/source';

const now = new Date('2026-12-01T03:20:00Z');
const ctx = { now, state: 'PRK', useMocks: true } as SourceContext;
const HOUR = 3600_000;

function newest(records: Record<string, unknown>[], field: string): number {
  return Math.max(...records.map((r) => Date.parse(String(r[field]))));
}

describe('mock fallbacks', () => {
  it('firms: hotspots rebased to now and tagged as mock', () => {
    const rows = firmsSource.mock(ctx);
    expect(rows.length).toBeGreaterThan(50);
    expect(newest(rows as never, 'acquiredAt')).toBe(Date.parse('2026-12-01T03:15:00Z'));
    expect(rows.every((r) => r.source === 'mock')).toBe(true);
  });

  it('infobanjir: rain, water level and alerts are current and flagged', () => {
    const rain = rainSource.mock(ctx);
    const wl = waterLevelSource.mock(ctx);
    const alerts = alertsSource.mock(ctx);
    expect(rain).toHaveLength(47);
    expect(wl).toHaveLength(28);
    expect(alerts.length).toBeGreaterThan(0);
    for (const [rows, field] of [
      [rain, 'observedAt'],
      [wl, 'observedAt'],
      [alerts, 'issuedAt'],
    ] as const) {
      expect(now.getTime() - newest(rows as never, field)).toBeLessThan(15 * 60_000);
    }
    expect(rain.every((r) => r.mock)).toBe(true);
  });

  it('open-meteo: synthetic grids cover the forecast window with the right fields', () => {
    const wind = openMeteoWindSource.mock(ctx);
    const aq = openMeteoAirQualitySource.mock(ctx);
    const local = openMeteoLocalSource.mock(ctx);
    expect(wind[0]).toHaveProperty('windDir850');
    expect(wind[0]).not.toHaveProperty('pm2_5');
    expect(aq[0]).toHaveProperty('pm2_5');
    expect(local[0]).toHaveProperty('precip');
    expect(newest(wind as never, 'validAt') - now.getTime()).toBeGreaterThan(70 * HOUR);
    // SW monsoon: wind comes from roughly 205–245°.
    expect(wind.every((r) => r.windDir850! > 200 && r.windDir850! < 250)).toBe(true);
  });
});

describe('rebaseTimes', () => {
  it('shifts all fields by the same offset so the newest is now (15-min floor)', () => {
    const out = rebaseTimes(
      [{ t: '2026-01-01T00:00:00Z' }, { t: '2026-01-01T02:00:00Z' }],
      ['t'],
      new Date('2026-06-01T10:07:00Z'),
    );
    expect(out.map((r) => r.t)).toEqual(['2026-06-01T08:00:00.000Z', '2026-06-01T10:00:00.000Z']);
  });
});
