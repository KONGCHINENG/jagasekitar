// "How dangerous is this spot?" Used by the notification job, the "Your area" card and
// destination search. Pure: give it the zones (e.g. from zones_in_bbox) and a point.
import type { HazardZone, PointAssessment, RiskLevel } from '@jagasekitar/shared';
import { maxRisk, riskRank } from '@jagasekitar/shared';
import { diseaseAdvice, floodAdvice, hazeAdvice, uniqueAdvice } from './advice';
import { areaBbox, pointInArea } from './geom';

export interface AssessOptions {
  /** Time to assess at (e.g. arrival time at a destination). Defaults to now. */
  time?: Date;
}

/** Disease code from a disease zone id ("disease:<district>:<CODE>"). */
function diseaseCode(z: HazardZone): string | null {
  return z.hazard === 'disease' ? (z.id.split(':').at(-1) ?? null) : null;
}

export function assessPoint(
  lat: number,
  lon: number,
  zones: HazardZone[],
  opts: AssessOptions = {},
): PointAssessment {
  const t = (opts.time ?? new Date()).getTime();
  const hits = zones.filter((z) => {
    if (Date.parse(z.validFrom) > t || Date.parse(z.validTo) <= t) return false;
    const [w, s, e, n] = areaBbox(z.geometry);
    if (lon < w || lon > e || lat < s || lat > n) return false; // cheap reject first
    return pointInArea(lat, lon, z.geometry);
  });

  const levelOf = (hazard: HazardZone['hazard']): RiskLevel =>
    maxRisk(...hits.filter((z) => z.hazard === hazard).map((z) => z.level));
  const haze = levelOf('haze');
  const flood = levelOf('flood');
  const disease = levelOf('disease');

  // Disease advice only for diseases at moderate or above, worst first.
  const diseaseCodes = hits
    .filter((z) => z.hazard === 'disease' && riskRank(z.level) >= riskRank('moderate'))
    .sort((a, b) => riskRank(b.level) - riskRank(a.level))
    .map(diseaseCode)
    .filter((c): c is string => !!c);

  return {
    haze,
    flood,
    disease,
    overall: maxRisk(haze, flood, disease),
    zones: hits.sort((a, b) => riskRank(b.level) - riskRank(a.level)),
    // Most urgent hazard's advice first.
    advice: uniqueAdvice(
      [
        { rank: riskRank(flood), advice: floodAdvice(flood) },
        { rank: riskRank(haze), advice: hazeAdvice(haze) },
        { rank: riskRank(disease), advice: diseaseAdvice(diseaseCodes) },
      ]
        .sort((a, b) => b.rank - a.rank)
        .flatMap((x) => x.advice),
    ),
  };
}
