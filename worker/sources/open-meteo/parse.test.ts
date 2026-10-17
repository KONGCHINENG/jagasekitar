import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AQ_VARS, FORECAST_VARS, chunk, gridPoints, parseHourly, toDbRow } from './parse';

const fixture = (f: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as unknown;
const POINTS = [
  { lat: 4.6, lon: 101.1 },
  { lat: 1, lon: 101.5 },
];
const ALL_TIME = { from: 0, to: Number.MAX_SAFE_INTEGER };

describe('gridPoints', () => {
  it('covers the bbox inclusively without float drift', () => {
    const pts = gridPoints([100.3, 3.6, 101.9, 6.0], 0.25);
    expect(pts).toHaveLength(7 * 10);
    expect(pts[1]).toEqual({ lat: 3.6, lon: 100.55 });
    expect(pts.at(-1)).toEqual({ lat: 5.85, lon: 101.8 });
  });
  it('1° haze grid stays inside the free-tier budget', () => {
    expect(gridPoints([95, -6, 120, 8], 1)).toHaveLength(26 * 15);
  });
});

describe('chunk', () => {
  it('splits into fixed-size batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('parseHourly', () => {
  it('keys forecast rows by requested coordinates', () => {
    const rows = parseHourly(fixture('forecast-2pts.json'), POINTS, FORECAST_VARS, ALL_TIME);
    expect(rows).toHaveLength(2 * 72);
    const first = rows[0]!;
    expect(first.lat).toBe(4.6);
    expect(first.validAt).toMatch(/T00:00:00\.000Z$/);
    expect(first).toHaveProperty('windDir850');
    expect(first).toHaveProperty('precipProb');
    expect(rows[72]!.lon).toBe(101.5);
  });

  it('parses air quality and filters to the time window', () => {
    const body = fixture('air-quality-2pts.json') as { hourly: { time: string[] } }[];
    const t0 = Date.parse(`${body[0]!.hourly.time[10]}:00Z`);
    const rows = parseHourly(body, POINTS, AQ_VARS, { from: t0, to: t0 + 5 * 3600_000 });
    expect(rows).toHaveLength(2 * 6);
    expect(typeof rows[0]!.pm2_5).toBe('number');
  });

  it('rejects a location-count mismatch', () => {
    expect(() =>
      parseHourly(fixture('forecast-2pts.json'), POINTS.slice(0, 1), FORECAST_VARS, ALL_TIME),
    ).toThrow(/expected 1/);
  });
});

describe('toDbRow', () => {
  it('only includes fields the feed provides', () => {
    expect(toDbRow({ lat: 1, lon: 2, validAt: 'x', pm2_5: 30, pm10: 50 })).toEqual({
      lat: 1,
      lon: 2,
      valid_at: 'x',
      pm2_5: 30,
      pm10: 50,
    });
  });
});
