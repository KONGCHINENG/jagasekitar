// Typed reads for every map layer. All of these hit public views/RPCs (anon key + RLS).
import type { Hazard, HazardZone, RiskLevel } from '@jagasekitar/shared';
import type { MultiPolygon, Polygon } from 'geojson';
import { requireSupabase } from './supabase';

export type Bbox = [west: number, south: number, east: number, north: number];

export const DEFAULT_STATE = 'PRK';
/** Peninsular Malaysia plus the Strait: zones outside it aren't drawn. */
export const PENINSULA: Bbox = [99, 0.5, 105, 7.5];
export const IPOH = { latitude: 4.597, longitude: 101.09 };

export interface AppZone extends HazardZone {
  dbId: string;
  district: string | null;
  diseaseCode: string | null;
}

interface ZoneRow {
  id: string;
  hazard: Hazard;
  level: RiskLevel;
  valid_from: string;
  valid_to: string;
  confidence: number;
  reason_en: string;
  reason_ms: string | null;
  source_refs: string[];
  district: string | null;
  disease_code: string | null;
  geometry: Polygon | MultiPolygon;
}

function toZone(r: ZoneRow): AppZone {
  // Engine-style id so assessPoint/advice can read the disease code (disease:<district>:<CODE>).
  const id =
    r.hazard === 'disease'
      ? `disease:${r.district}:${r.disease_code}`
      : `${r.hazard}:${r.district ?? ''}:${r.level}`;
  return {
    id,
    dbId: r.id,
    hazard: r.hazard,
    level: r.level,
    geometry: r.geometry,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    confidence: r.confidence,
    reason: r.reason_en,
    reasonMs: r.reason_ms ?? undefined,
    sourceRefs: r.source_refs ?? [],
    district: r.district,
    diseaseCode: r.disease_code,
  };
}

async function unwrap<T>(
  p: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export async function fetchZones(bbox: Bbox, at: Date, hazard?: Hazard): Promise<AppZone[]> {
  const rows = await unwrap<ZoneRow[]>(
    requireSupabase().rpc('zones_in_bbox', {
      west: bbox[0],
      south: bbox[1],
      east: bbox[2],
      north: bbox[3],
      hazard_filter: hazard ?? null,
      at_time: at.toISOString(),
      tolerance: 0.003,
    }),
  );
  return rows.map(toZone);
}

export interface RainStation {
  station_id: string;
  name: string;
  district: string | null;
  lat: number;
  lon: number;
  observed_at: string;
  rain_1h: number | null;
  rain_3h: number | null;
  rain_24h: number | null;
  rain_since_midnight: number | null;
  simulated: boolean;
}

export const fetchRainStations = () =>
  unwrap<RainStation[]>(
    requireSupabase()
      .from('v_rain_stations_latest')
      .select(
        'station_id, name, district, lat, lon, observed_at, rain_1h, rain_3h, rain_24h, rain_since_midnight, simulated',
      )
      .eq('state', DEFAULT_STATE),
  );

export interface WaterStation {
  station_id: string;
  name: string;
  river: string | null;
  district: string | null;
  lat: number;
  lon: number;
  observed_at: string;
  level: number;
  status: 'normal' | 'alert' | 'warning' | 'danger';
  trend: 'rising' | 'falling' | 'steady' | null;
  alert_level: number | null;
  warning_level: number | null;
  danger_level: number | null;
  simulated: boolean;
}

export const fetchWaterStations = () =>
  unwrap<WaterStation[]>(
    requireSupabase()
      .from('v_water_stations_latest')
      .select(
        'station_id, name, river, district, lat, lon, observed_at, level, status, trend, alert_level, warning_level, danger_level, simulated',
      )
      .eq('state', DEFAULT_STATE),
  );

export interface HotspotCell {
  lat: number;
  lon: number;
  hotspots: number;
  frp_sum: number;
  simulated: boolean;
}

export const fetchHotspotCells = () =>
  unwrap<HotspotCell[]>(
    requireSupabase()
      .from('v_hotspot_cells')
      .select('lat, lon, hotspots, frp_sum, simulated')
      .order('frp_sum', { ascending: false })
      .limit(400),
  );

export interface WindPoint {
  lat: number;
  lon: number;
  speed: number;
  dir_from: number;
}

export const fetchWind = (at: Date) =>
  unwrap<WindPoint[]>(
    requireSupabase().rpc('map_wind', {
      p_at: at.toISOString(),
      west: 95,
      south: -6,
      east: 106,
      north: 8,
    }),
  );

export async function fetchPm25(lat: number, lon: number, at: Date): Promise<number | null> {
  const rows = await unwrap<{ pm2_5: number }[]>(
    requireSupabase().rpc('pm25_at', { lat, lon, p_at: at.toISOString() }),
  );
  return rows[0]?.pm2_5 ?? null;
}

export interface DistrictShape {
  name: string;
  population: number | null;
  centroid_lat: number;
  centroid_lon: number;
  geometry: Polygon | MultiPolygon | null;
}

export const fetchDistricts = () =>
  unwrap<DistrictShape[]>(
    requireSupabase()
      .from('v_districts_geojson')
      .select('name, population, centroid_lat, centroid_lon, geometry')
      .eq('state', DEFAULT_STATE),
  );

export interface DiseaseSummary {
  district: string;
  disease_code: string;
  disease_name_en: string;
  disease_name_ms: string;
  cases_7d: number;
  baseline_ratio: number | null;
  per_100k: number | null;
  trend_14d: number[];
}

export const fetchDiseaseSummary = () =>
  unwrap<DiseaseSummary[]>(
    requireSupabase()
      .from('v_disease_district_summary')
      .select(
        'district, disease_code, disease_name_en, disease_name_ms, cases_7d, baseline_ratio, per_100k, trend_14d',
      )
      .eq('state', DEFAULT_STATE),
  );

export interface DiseaseType {
  code: string;
  name_en: string;
  name_ms: string;
}

export const fetchDiseaseTypes = () =>
  unwrap<DiseaseType[]>(
    requireSupabase()
      .from('disease_types')
      .select('code, name_en, name_ms')
      .eq('active', true)
      .order('name_en'),
  );

export interface FacilityPin {
  facility_id: string;
  name: string;
  type: 'hospital' | 'clinic';
  district: string;
  lat: number;
  lon: number;
  reports_7d: number;
}

export const fetchFacilities = () =>
  unwrap<FacilityPin[]>(
    requireSupabase()
      .from('v_facility_report_counts')
      .select('facility_id, name, type, district, lat, lon, reports_7d')
      .eq('state', DEFAULT_STATE),
  );

export interface Freshness {
  source: string;
  last_success_at: string | null;
  used_mock: boolean;
}

export const fetchFreshness = () =>
  unwrap<Freshness[]>(
    requireSupabase().from('v_data_freshness').select('source, last_success_at, used_mock'),
  );
