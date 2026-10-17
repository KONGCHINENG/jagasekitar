import type { HazardZone } from '@jagasekitar/shared';
import { describe, expect, it } from 'vitest';
import { lineLengthKm, riskAlongRoute, sampleLine, type LonLat } from './route';

// Ipoh → Kuala Kangsar, roughly north-west (~29 km straight line).
const ROUTE: LonLat[] = [
  [101.09, 4.597],
  [101.0, 4.68],
  [100.937, 4.772],
];

const zone = (over: Partial<HazardZone>): HazardZone => ({
  id: 'flood:Kuala Kangsar:high',
  hazard: 'flood',
  level: 'high',
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [100.9, 4.74],
          [100.98, 4.74],
          [100.98, 4.8],
          [100.9, 4.8],
          [100.9, 4.74],
        ],
      ],
    ],
  },
  validFrom: '2026-10-17T00:00:00Z',
  validTo: '2026-10-18T00:00:00Z',
  confidence: 0.8,
  reason: '',
  sourceRefs: [],
  ...over,
});

describe('sampleLine', () => {
  it('samples about every step and keeps both ends', () => {
    const pts = sampleLine(ROUTE, 1);
    const km = lineLengthKm(ROUTE);
    expect(pts.length).toBeGreaterThanOrEqual(Math.floor(km));
    expect(pts.length).toBeLessThanOrEqual(Math.ceil(km) + 2);
    expect(pts[0]).toEqual(ROUTE[0]);
    expect(pts.at(-1)).toEqual(ROUTE.at(-1));
  });
});

describe('riskAlongRoute', () => {
  const time = new Date('2026-10-17T06:00:00Z');

  it('colours the part of the route inside a zone and names where', () => {
    const r = riskAlongRoute(ROUTE, [zone({})], { time });
    expect(r.worst).toBe('high');
    expect(r.segments[0]!.level).toBe('none');
    expect(r.segments.at(-1)!.level).toBe('high');
    expect(r.hits).toEqual([
      expect.objectContaining({ hazard: 'flood', level: 'high', near: 'Kuala Kangsar' }),
    ]);
    // Segments join up: the last point of one is the first of the next.
    expect(r.segments[0]!.coords.at(-1)).toEqual(r.segments[1]!.coords[0]);
  });

  it('names haze hits by the nearest place', () => {
    const haze = zone({ id: 'haze:+0h:moderate', hazard: 'haze', level: 'moderate' });
    const r = riskAlongRoute(ROUTE, [haze], {
      time,
      places: [
        { name: 'Sungai Siput', lat: 4.82, lon: 101.07 },
        { name: 'Batu Gajah', lat: 4.47, lon: 101.04 },
      ],
    });
    expect(r.hits[0]).toMatchObject({ hazard: 'haze', near: 'Sungai Siput' });
  });

  it('a clear route has a single none segment', () => {
    const r = riskAlongRoute(ROUTE, [], { time });
    expect(r).toMatchObject({ worst: 'none', hits: [] });
    expect(r.segments).toHaveLength(1);
  });
});
