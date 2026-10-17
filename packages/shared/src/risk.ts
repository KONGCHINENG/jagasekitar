/** Ordered risk levels shared by every hazard engine and UI. */
export const RISK_LEVELS = ['none', 'low', 'moderate', 'high', 'severe'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const HAZARDS = ['haze', 'flood', 'disease'] as const;
export type Hazard = (typeof HAZARDS)[number];

export function riskRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

export function maxRisk(...levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>((a, b) => (riskRank(b) > riskRank(a) ? b : a), 'none');
}

export function atLeast(level: RiskLevel, min: RiskLevel): boolean {
  return riskRank(level) >= riskRank(min);
}
