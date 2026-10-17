import type { HazardZone } from '@jagasekitar/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DISEASE } from './config';
import { baselineRatio, classifyDisease, runDiseaseEngine } from './disease';
import type { DiseaseSummaryInput, District } from './types';

const NOW = new Date('2026-10-17T06:00:00Z');
const box = (w: number, s: number, e: number, n: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
});
const KINTA: District = {
  state: 'PRK',
  name: 'Kinta',
  population: 840000,
  centroid: { lat: 4.6, lon: 101.09 },
  geometry: box(100.9, 4.3, 101.3, 4.8),
};
const KERIAN: District = {
  state: 'PRK',
  name: 'Kerian',
  population: 190000,
  centroid: { lat: 5.01, lon: 100.54 },
  geometry: box(100.4, 4.9, 100.7, 5.2),
};

const row = (over: Partial<DiseaseSummaryInput>): DiseaseSummaryInput => ({
  state: 'PRK',
  district: 'Kinta',
  diseaseCode: 'DENGUE',
  diseaseNameEn: 'Dengue',
  diseaseNameMs: 'Denggi',
  cases7d: 0,
  casesPrev28d: 0,
  population: 840000,
  ...over,
});

const zone = (hazard: 'flood' | 'haze', geometry = box(100.45, 4.95, 100.6, 5.1)): HazardZone => ({
  id: `${hazard}:x`,
  hazard,
  level: 'high',
  geometry: { type: 'MultiPolygon', coordinates: [geometry.coordinates] },
  validFrom: '2026-10-17T00:00:00Z',
  validTo: '2026-10-17T12:00:00Z',
  confidence: 0.8,
  reason: '',
  sourceRefs: [],
});

describe('outbreak ratio', () => {
  it('compares the last 7 days with the 28-day weekly baseline', () => {
    expect(baselineRatio(12, 16)).toBe(3); // usual 4/week
    expect(baselineRatio(5, 0)).toBeNull();
  });

  it('classifies by count and ratio (configurable)', () => {
    const cfg = DEFAULT_DISEASE;
    expect(
      classifyDisease({ cases7d: 12, casesPrev28d: 16, population: 840000 }, cfg),
    ).toMatchObject({ level: 'high', outbreak: true });
    expect(classifyDisease({ cases7d: 20, casesPrev28d: 16, population: 840000 }, cfg).level).toBe(
      'severe',
    ); // 5×
    expect(classifyDisease({ cases7d: 6, casesPrev28d: 16, population: 840000 }, cfg).level).toBe(
      'moderate',
    ); // 1.5×
    expect(classifyDisease({ cases7d: 3, casesPrev28d: 4, population: 840000 }, cfg).level).toBe(
      'moderate',
    ); // 3 ≥ min/2 and 3×
    expect(classifyDisease({ cases7d: 2, casesPrev28d: 40, population: 840000 }, cfg).level).toBe(
      'low',
    );
    expect(classifyDisease({ cases7d: 4, casesPrev28d: 16, population: 840000 }, cfg).level).toBe(
      'low',
    ); // below min count
    expect(
      classifyDisease(
        { cases7d: 12, casesPrev28d: 16, population: 840000 },
        { ...cfg, outbreakRatio: 4 },
      ).level,
    ).toBe('moderate');
  });

  it('a high rate per 100k alone makes it severe', () => {
    expect(
      classifyDisease({ cases7d: 60, casesPrev28d: 400, population: 100000 }, DEFAULT_DISEASE)
        .level,
    ).toBe('severe');
  });
});

describe('runDiseaseEngine', () => {
  it('produces a district choropleth zone with a bilingual explanation', () => {
    const { zones } = runDiseaseEngine({
      now: NOW,
      summaries: [row({ cases7d: 12, casesPrev28d: 16 })],
      districts: [KINTA, KERIAN],
    });
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ id: 'disease:Kinta:DENGUE', level: 'high' });
    expect(zones[0]!.reason).toBe(
      'Dengue: 12 cases reported in Kinta in the last 7 days, 3.0× the usual rate (1.4 per 100k). Possible outbreak.',
    );
    expect(zones[0]!.reasonMs).toMatch(/^Denggi: 12 kes dilaporkan di Kinta/);
  });

  it('flooding raises water-borne disease risk in the flooded district only', () => {
    const { zones } = runDiseaseEngine({
      now: NOW,
      summaries: [
        row({
          district: 'Kerian',
          diseaseCode: 'LEPTO',
          diseaseNameEn: 'Leptospirosis',
          diseaseNameMs: 'Leptospirosis',
          cases7d: 2,
          casesPrev28d: 8,
          population: 190000,
        }),
        row({ cases7d: 2, casesPrev28d: 8 }),
      ],
      districts: [KINTA, KERIAN],
      hazardZones: [zone('flood')],
      diseaseNames: { CHOLERA: { en: 'Cholera', ms: 'Taun' } },
    });
    const lepto = zones.find((z) => z.id === 'disease:Kerian:LEPTO')!;
    expect(lepto.level).toBe('moderate'); // low raised one level
    expect(lepto.reason).toMatch(/Flooding in Kerian → higher leptospirosis risk\./);
    // Linked diseases without reports get a tentative low heads-up.
    const cholera = zones.find((z) => z.id === 'disease:Kerian:CHOLERA')!;
    expect(cholera.level).toBe('low');
    expect(cholera.reasonMs).toBe('Banjir di Kerian → risiko taun lebih tinggi.');
    expect(cholera.confidence).toBeLessThan(0.5);
    // Kinta isn't flooded: its dengue stays low.
    expect(zones.find((z) => z.id === 'disease:Kinta:DENGUE')!.level).toBe('low');
  });

  it('haze raises respiratory risk; expired or low zones are ignored', () => {
    const run = (z: HazardZone) =>
      runDiseaseEngine({
        now: NOW,
        summaries: [
          row({
            diseaseCode: 'ARI',
            diseaseNameEn: 'Acute respiratory infection',
            diseaseNameMs: 'ARI',
            cases7d: 1,
            casesPrev28d: 8,
          }),
        ],
        districts: [KINTA],
        hazardZones: [z],
      }).zones.find((x) => x.id === 'disease:Kinta:ARI')!.level;
    const hazeOverKinta = zone('haze', box(101.0, 4.5, 101.2, 4.7));
    expect(run(hazeOverKinta)).toBe('moderate');
    expect(run({ ...hazeOverKinta, validTo: '2026-10-17T03:00:00Z' })).toBe('low');
    expect(run({ ...hazeOverKinta, level: 'low' })).toBe('low');
  });
});
