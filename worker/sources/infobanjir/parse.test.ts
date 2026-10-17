// Parser tests against real responses saved from publicinfobanjir.water.gov.my on 2026-10-17.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  InfobanjirLayoutError,
  jpsGridCoords,
  normalizeStationId,
  num,
  parseCurrentAlerts,
  parseMyDateTime,
  parseRainfall,
  parseWaterLevel,
  statusFor,
} from './parse';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

describe('helpers', () => {
  it('parses Malaysia-time timestamps to UTC', () => {
    expect(parseMyDateTime('17/10/2026 14:30:00')).toBe('2026-10-17T06:30:00.000Z');
    expect(parseMyDateTime('7/1/2026 08:05')).toBe('2026-01-07T00:05:00.000Z');
    expect(parseMyDateTime('n/a')).toBeNull();
  });
  it('treats dashes, blanks and sentinels as missing', () => {
    expect([num('12.5'), num('-'), num(''), num('-9999'), num('0.0')]).toEqual([
      12.5,
      null,
      null,
      null,
      0,
    ]);
  });
  it('normalizes mixed station id formats', () => {
    expect(normalizeStationId('5006021_ Kolam Air Bukit Merah')).toBe('5006021');
    expect(normalizeStationId(' 27628 ')).toBe('27628');
  });
  it('decodes JPS grid station numbers', () => {
    expect(jpsGridCoords('5207406')).toEqual({ lat: 5.25, lon: 100.75 });
    expect(jpsGridCoords('28179')).toBeNull();
  });
  it('derives water status from thresholds', () => {
    const t = { alert: 19.5, warning: 19.8, danger: 20 };
    expect([16.5, 19.6, 19.9, 20.1].map((l) => statusFor(l, t))).toEqual([
      'normal',
      'alert',
      'warning',
      'danger',
    ]);
  });
});

describe('parseRainfall', () => {
  const rows = parseRainfall(fixture('rainfall-prk.html'));

  it('finds every station row despite malformed markup', () => {
    expect(rows).toHaveLength(47);
  });

  it('maps the first row by label, not by header position', () => {
    expect(rows[0]).toMatchObject({
      stationId: '28179',
      name: 'S. K. Matang (F2)',
      district: 'Larut Matang dan Selama',
      observedAt: '2026-10-17T06:30:00.000Z',
      rainSinceMidnight: 0,
      rain1h: 0,
      rain3h: 0,
      rain6h: 0,
      rain24h: 16.5,
      rain72h: 98.5,
    });
    // Most recent day first; header dates are 11/10 … 16/10.
    expect(rows[0]!.daily[0]).toEqual({ date: '2026-10-16', mm: 24.5 });
    expect(rows[0]!.daily.at(-1)).toEqual({ date: '2026-10-11', mm: 5 });
  });

  it('gives every station a unique id', () => {
    expect(new Set(rows.map((r) => r.stationId)).size).toBe(rows.length);
  });

  it('fails loudly when the layout changes', () => {
    expect(() => parseRainfall('<table><tr><th>Something else</th></tr></table>')).toThrow(
      InfobanjirLayoutError,
    );
  });
});

describe('parseWaterLevel', () => {
  const rows = parseWaterLevel(fixture('water-level-prk.html'));

  it('parses stations with official thresholds', () => {
    expect(rows).toHaveLength(28);
    expect(rows[0]).toMatchObject({
      stationId: '5207406',
      name: 'Sg. Mengkuang di Kg. Sg. Kuning',
      district: 'Larut Matang dan Selama',
      basin: 'Sungai Kerian',
      river: 'Sg. Mengkuang',
      observedAt: '2026-10-17T06:00:00.000Z',
      level: 16.53,
      normal: 17.4,
      alert: 19.5,
      warning: 19.8,
      danger: 20,
      status: 'normal',
    });
  });

  it('falls back to the graph-link id when the Station ID cell is empty', () => {
    const rui = rows.find((r) => r.name.startsWith('Sg. Rui'));
    expect(rui?.stationId).toBe('25790');
    expect(new Set(rows.map((r) => r.stationId)).size).toBe(rows.length);
  });

  it('computes status for every row', () => {
    expect(rows.every((r) => ['normal', 'alert', 'warning', 'danger'].includes(r.status))).toBe(
      true,
    );
  });
});

describe('parseCurrentAlerts', () => {
  const alerts = parseCurrentAlerts(fixture('currentalert.json'));

  it('keeps only water-level Alert+ or heavy rain', () => {
    // Fixture: 3 water-level "Alert", 9 "Heavy" + 1 "Very Heavy" rain (some overlap).
    expect(alerts.length).toBeGreaterThanOrEqual(10);
    expect(alerts.length).toBeLessThanOrEqual(13);
    expect(alerts.every((a) => ['moderate', 'high', 'severe'].includes(a.level))).toBe(true);
  });

  it('maps very heavy rain to high and keeps coordinates', () => {
    const veryHeavy = alerts.find((a) => a.rainSeverity === 'Very Heavy');
    expect(veryHeavy?.level).toBe('high');
    expect(veryHeavy?.lat).toBeTypeOf('number');
  });

  it('strips id prefixes from station names', () => {
    expect(alerts.every((a) => !/^\d+_/.test(a.stationName))).toBe(true);
  });

  it('rejects non-array payloads', () => {
    expect(() => parseCurrentAlerts('{"error":"x"}')).toThrow(InfobanjirLayoutError);
  });
});
