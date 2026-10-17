import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOOD } from './config';
import { assessRainStation, assessWaterStation, forecastAt, runFloodEngine } from './flood';
import { circleArea, pointInArea } from './geom';
import type { District, PrecipSample, RainStationInput, WaterStationInput } from './types';

const NOW = new Date('2026-10-17T06:00:00Z');
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString();

const rain = (over: Partial<RainStationInput> = {}): RainStationInput => ({
  stationId: 'R1',
  name: 'Kuala Kangsar',
  district: 'Kuala Kangsar',
  lat: 4.77,
  lon: 100.94,
  observedAt: iso(0.25),
  rain1h: 0,
  rain3h: 0,
  rain24h: 0,
  rain72h: 0,
  ...over,
});

const river = (over: Partial<WaterStationInput> = {}): WaterStationInput => ({
  stationId: 'W1',
  name: 'Sg. Perak di Kuala Kangsar',
  river: 'Sungai Perak',
  district: 'Kuala Kangsar',
  lat: 4.77,
  lon: 100.95,
  observedAt: iso(0.25),
  level: 30,
  status: 'normal',
  trend: 'steady',
  ...over,
});

describe('rain station rules', () => {
  const cfg = DEFAULT_FLOOD;
  it('severe: > 60 mm in 3 h with a rising river nearby', () => {
    const r = assessRainStation(rain({ rain3h: 72 }), null, river({ trend: 'rising' }), cfg);
    expect(r.level).toBe('severe');
    expect(r.reasonEn).toBe('72 mm rain in 3 hours at Kuala Kangsar and Sungai Perak is rising');
  });
  it('high: > 60 mm in 3 h without a rising river', () => {
    expect(assessRainStation(rain({ rain3h: 61 }), null, undefined, cfg).level).toBe('high');
  });
  it('high: big forecast on saturated ground', () => {
    const r = assessRainStation(
      rain({ rain72h: 160 }),
      { next6h: 40, next24h: 110, maxHourly: 20 },
      undefined,
      cfg,
    );
    expect(r.level).toBe('high');
    expect(r.reasonEn).toMatch(/110 mm more rain forecast in 24 hours after 160 mm in 3 days/);
  });
  it('big forecast alone (dry ground) is not high', () => {
    expect(
      assessRainStation(
        rain({ rain72h: 20 }),
        { next6h: 40, next24h: 110, maxHourly: 20 },
        undefined,
        cfg,
      ).level,
    ).toBe('low');
  });
  it('moderate: heavy rain observed or forecast; low: moderate rain', () => {
    expect(assessRainStation(rain({ rain1h: 35 }), null, undefined, cfg).level).toBe('moderate');
    expect(
      assessRainStation(rain(), { next6h: 0, next24h: 40, maxHourly: 32 }, undefined, cfg).level,
    ).toBe('moderate');
    expect(assessRainStation(rain({ rain1h: 12 }), null, undefined, cfg).level).toBe('low');
    expect(assessRainStation(rain({ rain1h: 5 }), null, undefined, cfg).level).toBe('none');
  });
  it('thresholds are configurable', () => {
    expect(
      assessRainStation(rain({ rain3h: 45 }), null, undefined, { ...cfg, high3hMm: 40 }).level,
    ).toBe('high');
  });
});

describe('water level rules', () => {
  it('maps JPS status to risk and explains it bilingually', () => {
    expect(assessWaterStation(river({ status: 'alert' })).level).toBe('moderate');
    expect(assessWaterStation(river({ status: 'danger' })).level).toBe('severe');
    const w = assessWaterStation(river({ status: 'warning', trend: 'rising' }));
    expect(w.level).toBe('high');
    expect(w.reasonEn).toBe('Sungai Perak at Warning level (rising) at Sg. Perak di Kuala Kangsar');
    expect(w.reasonMs).toBe(
      'Sungai Perak pada paras Amaran (meningkat) di Sg. Perak di Kuala Kangsar',
    );
  });
});

describe('forecastAt', () => {
  it('sums the nearest grid point over the next 6 and 24 hours', () => {
    const samples: PrecipSample[] = [];
    for (let h = -2; h < 30; h++) {
      const validAt = new Date(NOW.getTime() + h * 3600_000).toISOString();
      samples.push({ lat: 4.75, lon: 101.0, validAt, precip: 2 });
      samples.push({ lat: 5.5, lon: 101.0, validAt, precip: 50 });
    }
    expect(forecastAt(4.77, 100.94, samples, NOW.getTime())).toEqual({
      next6h: 12,
      next24h: 48,
      maxHourly: 2,
    });
    expect(forecastAt(1, 103, samples, NOW.getTime())).toBeNull();
  });
});

describe('runFloodEngine', () => {
  const district: District = {
    state: 'PRK',
    name: 'Kuala Kangsar',
    population: 165000,
    centroid: { lat: 4.77, lon: 100.94 },
    // A box that cuts through the station's buffer, to prove clipping.
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [100.8, 4.6],
          [100.96, 4.6],
          [100.96, 4.9],
          [100.8, 4.9],
          [100.8, 4.6],
        ],
      ],
    },
  };

  it('turns the demo flash-flood scenario into a severe zone with the reasons', () => {
    const result = runFloodEngine({
      now: NOW,
      rain: [rain({ rain3h: 72 })],
      water: [river({ status: 'warning', trend: 'rising' })],
      districts: [district],
    });
    const severe = result.zones.find((z) => z.level === 'severe')!;
    expect(severe.reason).toMatch(/^Flood risk severe \(Kuala Kangsar\): 72 mm rain in 3 hours/);
    expect(pointInArea(4.77, 100.94, severe.geometry)).toBe(true);
    // Clipped at the district's east edge (100.96) although the 8 km buffer reaches ~101.01.
    expect(pointInArea(4.77, 101.0, severe.geometry)).toBe(false);
    expect(result.zones.map((z) => z.level)).toEqual(['severe', 'high']);
    expect(severe.validTo).toBe('2026-10-17T12:00:00.000Z');
  });

  it('ignores stale gauges', () => {
    const result = runFloodEngine({
      now: NOW,
      rain: [rain({ rain3h: 90, observedAt: iso(30 * 24) })],
      water: [],
    });
    expect(result.zones).toEqual([]);
    expect(result.stats.staleSkipped).toBe(1);
  });

  it('official JPS alerts are at least high', () => {
    const result = runFloodEngine({
      now: NOW,
      rain: [],
      water: [],
      alerts: [
        {
          stationId: 'X',
          title: 'Heavy rain at Bota',
          level: 'moderate',
          lat: 4.35,
          lon: 100.89,
          district: 'Perak Tengah',
        },
      ],
    });
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]!.level).toBe('high');
    expect(result.zones[0]!.reasonMs).toMatch(/Amaran rasmi JPS/);
  });

  it('merges overlapping buffers of the same level into one zone', () => {
    const result = runFloodEngine({
      now: NOW,
      rain: [rain({ stationId: 'A', rain1h: 40 }), rain({ stationId: 'B', rain1h: 40, lat: 4.8 })],
      water: [],
    });
    expect(result.zones).toHaveLength(1);
    const z = result.zones[0]!;
    expect(z.geometry.coordinates).toHaveLength(1); // one merged polygon
    expect(pointInArea(4.785, 100.94, z.geometry)).toBe(true);
    expect(circleArea(4.77, 100.94, 4).type).toBe('Polygon');
  });
});
