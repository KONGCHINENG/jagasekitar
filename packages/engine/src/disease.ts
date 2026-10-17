// Disease engine: district-level risk from aggregate hospital reports.
//
// Per district and disease:
//   ratio    = cases in the last 7 days ÷ (cases in the previous 28 days ÷ 4)
//   per 100k = 7-day cases ÷ district population × 100,000
//   severe   count ≥ min AND (ratio ≥ 2 × outbreakRatio OR per 100k ≥ severePer100k)
//   high     count ≥ min AND ratio ≥ outbreakRatio          ← the "outbreak" flag
//   moderate count ≥ min AND ratio ≥ 1.25, or count ≥ min/2 AND ratio ≥ outbreakRatio
//   low      any cases
// Linkage (shown as "why", never as a diagnosis): an active flood zone (≥ moderate) in the
// district raises water/vector-borne diseases one level, and active haze raises respiratory/eye
// conditions. A linked disease with no reports yet still gets a "low" heads-up.
import type { HazardZone, RiskLevel } from '@jagasekitar/shared';
import { RISK_LEVELS, atLeast, riskRank } from '@jagasekitar/shared';
import { DEFAULT_DISEASE, type DiseaseConfig } from './config';
import { intersectAreas, pointInArea, toMulti } from './geom';
import type { DiseaseSummaryInput, District } from './types';

const HOUR = 3600_000;

export interface DiseaseAssessment {
  district: string;
  diseaseCode: string;
  level: RiskLevel;
  ratio: number | null; // null when there is no baseline
  per100k: number | null;
  outbreak: boolean;
  linkedTo: ('flood' | 'haze')[];
}

export function baselineRatio(cases7d: number, casesPrev28d: number): number | null {
  if (casesPrev28d <= 0) return null;
  return cases7d / (casesPrev28d / 4);
}

export function classifyDisease(
  s: Pick<DiseaseSummaryInput, 'cases7d' | 'casesPrev28d' | 'population'>,
  cfg: DiseaseConfig,
): { level: RiskLevel; ratio: number | null; per100k: number | null; outbreak: boolean } {
  const ratio = baselineRatio(s.cases7d, s.casesPrev28d);
  // No baseline but cases now: treat as a large rise.
  const r = ratio ?? (s.cases7d > 0 ? Infinity : 0);
  const per100k = s.population ? (s.cases7d * 100_000) / s.population : null;
  const enough = s.cases7d >= cfg.outbreakMinCount;
  let level: RiskLevel = 'none';
  if (enough && (r >= 2 * cfg.outbreakRatio || (per100k ?? 0) >= cfg.severePer100k))
    level = 'severe';
  else if (enough && r >= cfg.outbreakRatio) level = 'high';
  else if (
    (enough && r >= 1.25) ||
    (s.cases7d >= Math.ceil(cfg.outbreakMinCount / 2) && r >= cfg.outbreakRatio)
  )
    level = 'moderate';
  else if (s.cases7d > 0) level = 'low';
  return { level, ratio, per100k, outbreak: enough && r >= cfg.outbreakRatio };
}

const raise = (level: RiskLevel): RiskLevel =>
  RISK_LEVELS[Math.min(riskRank(level) + 1, RISK_LEVELS.length - 1)]!;

export interface DiseaseInput {
  now: Date;
  summaries: DiseaseSummaryInput[];
  districts: District[];
  /** Currently active flood/haze zones, used for linkage. */
  hazardZones?: HazardZone[];
  /** code → names, for linked diseases that have no reports yet. */
  diseaseNames?: Record<string, { en: string; ms: string }>;
  config?: Partial<DiseaseConfig>;
}

export interface DiseaseResult {
  zones: HazardZone[];
  assessments: DiseaseAssessment[];
}

function districtTouches(d: District, zones: HazardZone[]): boolean {
  return zones.some((z) =>
    d.geometry
      ? intersectAreas(d.geometry, z.geometry) !== null
      : pointInArea(d.centroid.lat, d.centroid.lon, z.geometry),
  );
}

export function runDiseaseEngine(input: DiseaseInput): DiseaseResult {
  const cfg: DiseaseConfig = { ...DEFAULT_DISEASE, ...input.config };
  const now = input.now.getTime();
  const active = (input.hazardZones ?? []).filter(
    (z) =>
      atLeast(z.level, 'moderate') && Date.parse(z.validFrom) <= now && Date.parse(z.validTo) > now,
  );
  const floodZones = active.filter((z) => z.hazard === 'flood');
  const hazeZones = active.filter((z) => z.hazard === 'haze');

  const zones: HazardZone[] = [];
  const assessments: DiseaseAssessment[] = [];

  for (const district of input.districts) {
    const flooded = floodZones.length > 0 && districtTouches(district, floodZones);
    const hazy = hazeZones.length > 0 && districtTouches(district, hazeZones);
    const rows = input.summaries.filter(
      (s) => s.district === district.name && s.state === district.state,
    );

    // Linked diseases with no reports yet still get a heads-up when the hazard is present.
    const linkedCodes = [...(flooded ? cfg.floodLinked : []), ...(hazy ? cfg.hazeLinked : [])];
    for (const code of linkedCodes) {
      if (rows.some((r) => r.diseaseCode === code)) continue;
      const names = input.diseaseNames?.[code] ?? { en: code, ms: code };
      rows.push({
        state: district.state,
        district: district.name,
        diseaseCode: code,
        diseaseNameEn: names.en,
        diseaseNameMs: names.ms,
        cases7d: 0,
        casesPrev28d: 0,
        population: district.population,
      });
    }

    for (const s of rows) {
      const c = classifyDisease({ ...s, population: s.population ?? district.population }, cfg);
      const linkedTo: ('flood' | 'haze')[] = [];
      if (flooded && cfg.floodLinked.includes(s.diseaseCode)) linkedTo.push('flood');
      if (hazy && cfg.hazeLinked.includes(s.diseaseCode)) linkedTo.push('haze');
      const level = linkedTo.length ? raise(c.level) : c.level;
      assessments.push({
        district: district.name,
        diseaseCode: s.diseaseCode,
        level,
        ratio: c.ratio,
        per100k: c.per100k,
        outbreak: c.outbreak,
        linkedTo,
      });
      if (level === 'none' || !district.geometry) continue;

      const { en, ms } = diseaseReason(s, c, linkedTo, district.name);
      zones.push({
        id: `disease:${district.name}:${s.diseaseCode}`,
        hazard: 'disease',
        level,
        geometry: toMulti(district.geometry),
        validFrom: new Date(now).toISOString(),
        validTo: new Date(now + cfg.validHours * HOUR).toISOString(),
        // More cases → firmer signal; hazard-linked heads-ups without cases are tentative.
        confidence:
          Math.round(Math.min(0.9, s.cases7d > 0 ? 0.5 + s.cases7d / 50 : 0.35) * 100) / 100,
        reason: en,
        reasonMs: ms,
        sourceRefs: [
          ...(s.cases7d > 0 ? ['Hospital & clinic reports (aggregate)'] : []),
          ...linkedTo.map((h) => (h === 'flood' ? 'Flood zones' : 'Haze zones')),
        ],
      });
    }
  }
  return { zones, assessments };
}

const LINK_TEXT = {
  flood: { en: 'Flooding', ms: 'Banjir' },
  haze: { en: 'Haze', ms: 'Jerebu' },
};

export function diseaseReason(
  s: DiseaseSummaryInput,
  c: { ratio: number | null; per100k: number | null; outbreak: boolean },
  linkedTo: ('flood' | 'haze')[],
  district: string,
): { en: string; ms: string } {
  const en: string[] = [];
  const ms: string[] = [];
  if (s.cases7d > 0) {
    let e = `${s.diseaseNameEn}: ${s.cases7d} case${s.cases7d === 1 ? '' : 's'} reported in ${district} in the last 7 days`;
    let m = `${s.diseaseNameMs}: ${s.cases7d} kes dilaporkan di ${district} dalam 7 hari lalu`;
    if (c.ratio != null) {
      e += `, ${c.ratio.toFixed(1)}× the usual rate`;
      m += `, ${c.ratio.toFixed(1)}× kadar biasa`;
    } else {
      e += ' (no cases in the previous 4 weeks)';
      m += ' (tiada kes dalam 4 minggu sebelumnya)';
    }
    if (c.per100k != null) {
      e += ` (${c.per100k.toFixed(1)} per 100k)`;
      m += ` (${c.per100k.toFixed(1)} setiap 100k)`;
    }
    en.push(e + '.');
    ms.push(m + '.');
    if (c.outbreak) {
      en.push('Possible outbreak.');
      ms.push('Kemungkinan wabak.');
    }
  }
  for (const h of linkedTo) {
    en.push(`${LINK_TEXT[h].en} in ${district} → higher ${s.diseaseNameEn.toLowerCase()} risk.`);
    ms.push(
      `${LINK_TEXT[h].ms} di ${district} → risiko ${s.diseaseNameMs.toLowerCase()} lebih tinggi.`,
    );
  }
  return { en: en.join(' '), ms: ms.join(' ') };
}
