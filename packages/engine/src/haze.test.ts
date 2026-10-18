import { describe, expect, it } from 'vitest';
import { pointInArea } from './geom';
import {
  measuredHazeZones,
  WindField,
  addPuff,
  clusterHotspots,
  makeRaster,
  pm25Band,
  rasterBands,
  runHazeEngine,
  trajectory,
  vectorToBearing,
  windVector,
} from './haze';
import { DEFAULT_HAZE } from './config';
import type { Hotspot, WindSample } from './types';

const NOW = new Date('2026-10-17T00:00:00Z');
const MANJUNG = { name: 'Manjung', lat: 4.21, lon: 100.66 };
const KUANTAN = { name: 'Kuantan', lat: 3.8, lon: 103.33 };

/** Uniform wind over a 1° grid covering Sumatra–Peninsula for 4 days. */
function uniformWind(fromDeg: number, speed: number): WindSample[] {
  const out: WindSample[] = [];
  for (let h = -3; h <= 100; h += 3) {
    const validAt = new Date(NOW.getTime() + h * 3600_000).toISOString();
    for (let lat = -2; lat <= 8; lat++) {
      for (let lon = 95; lon <= 106; lon++) {
        out.push({
          lat,
          lon,
          validAt,
          windSpeed10m: speed,
          windDir10m: fromDeg,
          windSpeed850: speed,
          windDir850: fromDeg,
        });
      }
    }
  }
  return out;
}

/** A fire complex in North Sumatra (Labuhanbatu), south-west of Perak across the Strait. */
function fireComplex(n: number, frp = 30): Hotspot[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: 2.3 + (i % 5) * 0.02,
    lon: 100.0 + Math.floor(i / 5) * 0.02,
    frp,
    confidence: 'n' as const,
    acquiredAt: NOW.toISOString(),
  }));
}

describe('wind conversion', () => {
  it('a south-westerly (from 225°) moves air north-east', () => {
    const w = windVector(10, 225);
    expect(w.u).toBeCloseTo(7.071, 3);
    expect(w.v).toBeCloseTo(7.071, 3);
    expect(vectorToBearing(w).bearing).toBeCloseTo(45, 6);
  });
  it('a northerly (from 0°) moves air south', () => {
    expect(vectorToBearing(windVector(10, 0)).bearing).toBeCloseTo(180, 6);
  });
});

describe('trajectory', () => {
  it('steps hourly with the wind: 20 km/h southerly for 10 h moves ~200 km north', () => {
    const field = new WindField(uniformWind(180, 20));
    const path = trajectory(field, 1, 101, NOW.getTime(), 10);
    expect(path).toHaveLength(11);
    expect(path[10]!.lat - 1).toBeCloseTo(200 / 111.2, 1);
    expect(path[10]!.lon).toBeCloseTo(101, 3);
  });

  it('blends 850 hPa and 10 m winds as vectors', () => {
    const field = new WindField(
      [
        {
          lat: 0,
          lon: 100,
          validAt: NOW.toISOString(),
          windSpeed10m: 10,
          windDir10m: 270,
          windSpeed850: 10,
          windDir850: 180,
        },
      ],
      0.5,
    );
    const { bearing } = vectorToBearing(field.at(0, 100, NOW.getTime()));
    expect(bearing).toBeCloseTo(45, 3); // half east-moving, half north-moving
  });

  it('refuses to run without wind data', () => {
    expect(() => new WindField([])).toThrow(/No wind data/);
  });
});

describe('clusterHotspots', () => {
  it('groups points within the radius and drops low-confidence ones', () => {
    const hs: Hotspot[] = [
      { lat: 0.5, lon: 101.5, frp: 10, confidence: 'n', acquiredAt: '' },
      { lat: 0.53, lon: 101.5, frp: 30, confidence: 'h', acquiredAt: '' }, // ~3.3 km away
      { lat: 1.0, lon: 101.5, frp: 10, confidence: 'n', acquiredAt: '' }, // ~55 km away
      { lat: 0.51, lon: 101.51, frp: 99, confidence: 'l', acquiredAt: '' }, // dropped
    ];
    const clusters = clusterHotspots(hs, 10, 'n');
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ count: 2, frpSum: 40, region: 'Riau, Sumatra' });
    // FRP-weighted centre sits nearer the hotter fire.
    expect(clusters[0]!.lat).toBeCloseTo(0.5225, 4);
  });

  it('chains neighbours transitively', () => {
    const line = [0, 0.08, 0.16, 0.24].map((d) => ({
      lat: 1 + d,
      lon: 102,
      frp: 5,
      confidence: 'n' as const,
      acquiredAt: '',
    }));
    expect(clusterHotspots(line, 10)).toHaveLength(1);
  });
});

describe('raster bands', () => {
  it('contours a single puff into nested bands around its centre', () => {
    const r = makeRaster([100, 3, 102, 5], 5);
    addPuff(r, 4, 101, 20000, 6, DEFAULT_HAZE);
    const bands = rasterBands(r, DEFAULT_HAZE.scoreThresholds);
    expect(bands.size).toBeGreaterThan(1);
    const top = [...bands.entries()].at(-1)!;
    expect(pointInArea(4, 101, top[1])).toBe(true);
    expect(pointInArea(3.05, 100.05, top[1])).toBe(false);
  });
});

describe('pm25Band', () => {
  it('maps concentrations to API-style categories', () => {
    expect([10, 30, 50, 100, 200].map((v) => pm25Band(v))).toEqual([
      'good',
      'moderate',
      'unhealthy',
      'very_unhealthy',
      'hazardous',
    ]);
  });
});

describe('runHazeEngine', () => {
  it('carries Sumatran smoke over Perak on a south-south-westerly and explains why', () => {
    const t0 = Date.now();
    const result = runHazeEngine({
      now: NOW,
      hotspots: fireComplex(60),
      wind: uniformWind(200, 18),
      places: [MANJUNG, KUANTAN],
    });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(result.clusters).toHaveLength(1);

    const at24 = result.zones.filter((z) => z.id.startsWith('haze:+24h'));
    expect(at24.length).toBeGreaterThan(0);
    expect(at24.some((z) => pointInArea(MANJUNG.lat, MANJUNG.lon, z.geometry))).toBe(true);
    expect(result.zones.some((z) => pointInArea(KUANTAN.lat, KUANTAN.lon, z.geometry))).toBe(false);

    const overManjung = at24.find((z) => pointInArea(MANJUNG.lat, MANJUNG.lon, z.geometry))!;
    expect(overManjung.reason).toMatch(
      /60 fire hotspots in North Sumatra, carried NNE by ~18 km\/h winds/,
    );
    expect(overManjung.reason).toMatch(/Manjung/);
    expect(overManjung.reasonMs).toMatch(/titik panas/);
    // Time slices tile the forecast without gaps.
    const validFromBySlice = new Map(result.zones.map((z) => [z.id.split(':')[1], z]));
    const s0 = validFromBySlice.get('+0h');
    const s12 = validFromBySlice.get('+12h');
    if (s0 && s12) expect(s0.validTo).toBe(s12.validFrom);
  });

  it('produces nothing over Perak when the wind blows the smoke away', () => {
    const result = runHazeEngine({
      now: NOW,
      hotspots: fireComplex(60),
      wind: uniformWind(20, 18),
      places: [MANJUNG],
    });
    expect(result.zones.some((z) => pointInArea(MANJUNG.lat, MANJUNG.lon, z.geometry))).toBe(false);
  });

  it('returns no zones when there are no usable hotspots', () => {
    const result = runHazeEngine({ now: NOW, hotspots: [], wind: [] });
    expect(result.zones).toEqual([]);
  });

  it('more fire means a higher maximum level', () => {
    const rank = (n: number) => {
      const r = runHazeEngine({ now: NOW, hotspots: fireComplex(n), wind: uniformWind(200, 18) });
      return Math.max(
        ...r.zones.map((z) => ['none', 'low', 'moderate', 'high', 'severe'].indexOf(z.level)),
        0,
      );
    };
    expect(rank(300)).toBeGreaterThanOrEqual(rank(20));
  });
});

describe('measuredHazeZones', () => {
  const now = new Date('2026-10-18T04:00:00Z');
  const obs = (pm25: number, hoursAgo = 0.5) => ({
    name: 'Jalan Tasek, Ipoh',
    lat: 4.63,
    lon: 101.11,
    pm25,
    observedAt: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
  });

  it('turns unhealthy measured air into a zone around the station', () => {
    const [zone] = measuredHazeZones([obs(80)], now);
    expect(zone).toMatchObject({
      hazard: 'haze',
      level: 'high',
      confidence: 0.9,
      reason: 'Measured PM2.5 80 µg/m³ (Very Unhealthy) at Jalan Tasek, Ipoh.',
      reasonMs: 'PM2.5 diukur 80 µg/m³ (Sangat Tidak Sihat) di Jalan Tasek, Ipoh.',
      sourceRefs: ['DOE air quality (via WAQI)'],
    });
    expect(pointInArea(4.63, 101.11, zone!.geometry)).toBe(true);
    expect(pointInArea(4.9, 101.11, zone!.geometry)).toBe(false);
  });

  it('ignores good and moderate air, and old readings', () => {
    expect(measuredHazeZones([obs(12), obs(30)], now)).toEqual([]);
    expect(measuredHazeZones([obs(200, 5)], now)).toEqual([]);
    expect(measuredHazeZones([obs(40)], now)[0]?.level).toBe('moderate');
    expect(measuredHazeZones([obs(200)], now)[0]?.level).toBe('severe');
  });
});
