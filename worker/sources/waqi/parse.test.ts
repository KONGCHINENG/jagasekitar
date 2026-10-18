// WAQI parser tests. Fixtures follow the documented JSON API format (aqicn.org/json-api/doc);
// replace them with saved live responses once a WAQI_TOKEN is configured.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aqiToPm25, parseBounds, parseFeed } from './parse';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

describe('aqiToPm25', () => {
  it('inverts the EPA 2024 PM2.5 breakpoints', () => {
    expect(aqiToPm25(0)).toBe(0);
    expect(aqiToPm25(50)).toBe(9);
    expect(aqiToPm25(100)).toBe(35.4);
    expect(aqiToPm25(151)).toBe(55.5);
    expect(aqiToPm25(68)).toBe(18.2);
    expect(aqiToPm25(600)).toBe(325.4);
  });
});

describe('parseBounds', () => {
  it('keeps stations with a current reading', () => {
    expect(parseBounds(fixture('bounds.json'))).toEqual([
      {
        uid: 8662,
        lat: 4.6297,
        lon: 101.1131,
        aqi: 68,
        name: 'Jalan Tasek, Ipoh, Perak, Malaysia',
      },
    ]);
  });

  it('surfaces API errors such as a bad token', () => {
    expect(() => parseBounds('{"status":"error","data":"Invalid key"}')).toThrow('Invalid key');
  });
});

describe('parseFeed', () => {
  it('reads PM2.5 and time', () => {
    const [station] = parseBounds(fixture('bounds.json'));
    expect(parseFeed(fixture('feed.json'), station!)).toEqual({
      uid: 'waqi:8662',
      source: 'waqi',
      name: 'Jalan Tasek, Ipoh, Perak, Malaysia',
      lat: 4.6297,
      lon: 101.1131,
      pm25: 18.2,
      aqi: 68,
      observedAt: '2026-10-18T04:00:00.000Z',
    });
  });
});
