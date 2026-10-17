import type { HazardZone } from '@jagasekitar/shared';
import { describe, expect, it } from 'vitest';
import { assessPoint } from './assess';

const NOW = new Date('2026-10-17T06:00:00Z');
const square = (lon: number, lat: number, d = 0.1) => ({
  type: 'MultiPolygon' as const,
  coordinates: [
    [
      [
        [lon - d, lat - d],
        [lon + d, lat - d],
        [lon + d, lat + d],
        [lon - d, lat + d],
        [lon - d, lat - d],
      ],
    ],
  ],
});
const zone = (over: Partial<HazardZone>): HazardZone => ({
  id: 'x',
  hazard: 'flood',
  level: 'moderate',
  geometry: square(101, 4.6),
  validFrom: '2026-10-17T00:00:00Z',
  validTo: '2026-10-17T12:00:00Z',
  confidence: 0.8,
  reason: '',
  sourceRefs: [],
  ...over,
});

describe('assessPoint', () => {
  const zones = [
    zone({ id: 'flood:Kinta:high', level: 'high' }),
    zone({ id: 'flood:Kinta:low', level: 'low', geometry: square(101, 4.6, 0.3) }),
    zone({
      id: 'haze:+0h:moderate',
      hazard: 'haze',
      level: 'moderate',
      geometry: square(101, 4.6, 1),
    }),
    zone({
      id: 'haze:+24h:severe',
      hazard: 'haze',
      level: 'severe',
      validFrom: '2026-10-18T06:00:00Z',
      validTo: '2026-10-19T06:00:00Z',
      geometry: square(101, 4.6, 1),
    }),
    zone({
      id: 'disease:Kinta:DENGUE',
      hazard: 'disease',
      level: 'high',
      geometry: square(101, 4.6, 0.5),
    }),
    zone({
      id: 'disease:Kinta:LEPTO',
      hazard: 'disease',
      level: 'low',
      geometry: square(101, 4.6, 0.5),
    }),
  ];

  it('takes the worst level per hazard at the point and time', () => {
    const a = assessPoint(4.6, 101, zones, { time: NOW });
    expect(a).toMatchObject({ haze: 'moderate', flood: 'high', disease: 'high', overall: 'high' });
    expect(a.zones.map((z) => z.id)[0]).toMatch(/:high$|DENGUE/);
  });

  it('respects the arrival time (future haze slice)', () => {
    expect(assessPoint(4.6, 101, zones, { time: new Date('2026-10-18T09:00:00Z') }).haze).toBe(
      'severe',
    );
  });

  it('outside every zone is all clear with no advice', () => {
    const a = assessPoint(2, 103, zones, { time: NOW });
    expect(a).toMatchObject({
      haze: 'none',
      flood: 'none',
      disease: 'none',
      overall: 'none',
      zones: [],
      advice: [],
    });
  });

  it('gives bilingual advice, most urgent hazard first, without duplicates', () => {
    const a = assessPoint(4.6, 101, zones, { time: NOW });
    const en = a.advice.map((x) => x.en);
    expect(en[0]).toBe('Watch rainfall and JPS Public Infobanjir updates.');
    expect(en).toContain('Wear an N95 mask outdoors.');
    expect(en).toContain('Use mosquito repellent and remove stagnant water around your home.');
    // LEPTO is only "low" here, so no leptospirosis advice.
    expect(en.some((x) => x.includes('floodwater; wear boots'))).toBe(false);
    expect(new Set(en).size).toBe(en.length);
    expect(a.advice.every((x) => x.ms.length > 0)).toBe(true);
  });

  it('edge of the low flood ring: only low', () => {
    expect(assessPoint(4.85, 101, zones, { time: NOW }).flood).toBe('low');
  });
});
