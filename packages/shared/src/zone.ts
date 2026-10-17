import type { MultiPolygon, Polygon } from 'geojson';
import { z } from 'zod';
import { HAZARDS, RISK_LEVELS, type Hazard, type RiskLevel } from './risk';

/** Common output shape of every prediction engine (Section 4). */
export interface HazardZone {
  id: string;
  hazard: Hazard;
  level: RiskLevel;
  geometry: Polygon | MultiPolygon;
  validFrom: string; // ISO
  validTo: string; // ISO
  confidence: number; // 0–1
  reason: string; // human-readable "why", shown in the app
  reasonMs?: string;
  sourceRefs: string[];
}

export const riskLevelSchema = z.enum(RISK_LEVELS);
export const hazardSchema = z.enum(HAZARDS);

export const hazardZoneSchema = z.object({
  id: z.string(),
  hazard: hazardSchema,
  level: riskLevelSchema,
  geometry: z.custom<Polygon | MultiPolygon>((g) => {
    const type = (g as { type?: unknown } | null)?.type;
    return type === 'Polygon' || type === 'MultiPolygon';
  }),
  validFrom: z.iso.datetime({ offset: true }),
  validTo: z.iso.datetime({ offset: true }),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  reasonMs: z.string().optional(),
  sourceRefs: z.array(z.string()),
});

export interface Advice {
  en: string;
  ms: string;
}

export interface PointAssessment {
  haze: RiskLevel;
  flood: RiskLevel;
  disease: RiskLevel;
  overall: RiskLevel;
  zones: HazardZone[];
  advice: Advice[];
}
