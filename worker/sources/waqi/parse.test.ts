// WAQI parser tests: real responses saved on 2026-10-18 (token scrubbed), plus small hand-written
// ones in the documented format (aqicn.org/json-api/doc) for edge cases.
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
      official: true,
    });
  });
});

describe('live responses', () => {
  it('reads the stations around Perak, telling official monitors from community sensors', () => {
    const stations = parseBounds(fixture('bounds-live-2026-10-18.json'));
    expect(stations).toHaveLength(19);
    expect(stations.filter((s) => s.uid < 0)).toHaveLength(4);
    expect(stations.find((s) => s.uid === 2598)?.name).toBe('Tanjung Malim, Perak, Malaysia');
  });

  it('uses the PM2.5 sub-index, not the overall AQI', () => {
    const station = parseBounds(fixture('bounds-live-2026-10-18.json')).find(
      (s) => s.uid === 2597,
    )!;
    // Seri Manjung: overall AQI 95, PM2.5 sub-index 105 → 37.1 µg/m³.
    expect(parseFeed(fixture('feed-live-2026-10-18.json'), station)).toMatchObject({
      uid: 'waqi:2597',
      name: 'Seri Manjung, Perak, Malaysia',
      aqi: 95,
      pm25: 37.1,
      observedAt: '2026-10-18T04:00:00.000Z',
      official: true,
    });
  });
});
