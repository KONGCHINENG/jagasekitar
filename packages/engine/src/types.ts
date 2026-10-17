// Engine inputs. Plain data in, HazardZone[] out: the engines never touch the database.
import type { MultiPolygon, Polygon } from 'geojson';
import type { RiskLevel } from '@jagasekitar/shared';

export interface Hotspot {
  lat: number;
  lon: number;
  frp: number | null; // MW
  confidence: 'l' | 'n' | 'h';
  acquiredAt: string;
}

/** One weather_grid row. Directions are meteorological: where the wind comes FROM. */
export interface WindSample {
  lat: number;
  lon: number;
  validAt: string;
  windSpeed10m: number | null;
  windDir10m: number | null;
  windSpeed850: number | null;
  windDir850: number | null;
}

export interface Pm25Sample {
  lat: number;
  lon: number;
  validAt: string;
  pm25: number;
}

export interface PrecipSample {
  lat: number;
  lon: number;
  validAt: string;
  precip: number;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export interface District {
  state: string;
  name: string;
  population: number | null;
  centroid: { lat: number; lon: number };
  geometry: Polygon | MultiPolygon | null;
}

export interface RainStationInput {
  stationId: string;
  name: string;
  district: string | null;
  lat: number;
  lon: number;
  observedAt: string;
  rain1h: number | null;
  rain3h: number | null;
  rain24h: number | null;
  rain72h: number | null;
}

export interface WaterStationInput {
  stationId: string;
  name: string;
  river: string | null;
  district: string | null;
  lat: number;
  lon: number;
  observedAt: string;
  level: number;
  status: 'normal' | 'alert' | 'warning' | 'danger';
  trend: 'rising' | 'falling' | 'steady' | null;
}

export interface OfficialAlertInput {
  stationId: string | null;
  title: string;
  level: RiskLevel;
  lat: number | null;
  lon: number | null;
  district: string | null;
}

export interface DiseaseSummaryInput {
  state: string;
  district: string;
  diseaseCode: string;
  diseaseNameEn: string;
  diseaseNameMs: string;
  cases7d: number;
  casesPrev28d: number;
  population: number | null;
}
