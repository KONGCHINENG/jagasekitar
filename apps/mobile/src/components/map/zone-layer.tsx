// Turns HazardZones into WebMap polygons (one per polygon part, holes included).
import type { RiskLevel } from '@jagasekitar/shared';
import { riskRank } from '@jagasekitar/shared';
import type { MultiPolygon, Polygon as GeoPolygon, Position } from 'geojson';
import type { AppZone } from '@/lib/data';
import { zoneFill, zoneStroke } from '../risk';
import type { LatLng, MapPolygon } from './web-map';

const toLatLng = (ring: Position[]): LatLng[] =>
  ring.map(([lon, lat]) => ({ latitude: lat!, longitude: lon! }));

export function polygonParts(
  geometry: GeoPolygon | MultiPolygon,
): { outer: LatLng[]; holes: LatLng[][] }[] {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys
    .filter((rings) => (rings[0]?.length ?? 0) >= 4)
    .map((rings) => ({ outer: toLatLng(rings[0]!), holes: rings.slice(1).map(toLatLng) }));
}

export interface ZonePolygonOptions {
  /** 'hazard' uses each hazard's palette; 'neutral' draws subtle outlines (main map). */
  mode?: 'hazard' | 'neutral';
  fillOverride?: (zone: AppZone) => string | undefined;
}

const ZONE_PREFIX = 'zone:';

/** Polygons for the zones, low levels first so higher-risk ones draw on top and win taps. */
export function zonePolygons(
  zones: AppZone[],
  { mode = 'hazard', fillOverride }: ZonePolygonOptions = {},
): MapPolygon[] {
  return [...zones]
    .sort((a, b) => riskRank(a.level) - riskRank(b.level))
    .flatMap((zone) =>
      polygonParts(zone.geometry).map((part) => ({
        id: `${ZONE_PREFIX}${zone.dbId}`,
        rings: [part.outer, ...part.holes],
        fill:
          fillOverride?.(zone) ??
          (mode === 'neutral'
            ? zoneFill(zone.hazard, zone.level, '22')
            : zoneFill(zone.hazard, zone.level)),
        stroke: zoneStroke(zone.hazard, zone.level),
        width: mode === 'neutral' ? 1.5 : levelStroke(zone.level),
      })),
    );
}

/** The zone a tapped polygon id belongs to, if it was a zone. */
export function zoneForId(zones: AppZone[] | null | undefined, id: string): AppZone | undefined {
  if (!id.startsWith(ZONE_PREFIX)) return undefined;
  const dbId = id.slice(ZONE_PREFIX.length);
  return zones?.find((z) => `${z.dbId}` === dbId);
}

const levelStroke = (level: RiskLevel) => (riskRank(level) >= riskRank('high') ? 2.5 : 1.5);
