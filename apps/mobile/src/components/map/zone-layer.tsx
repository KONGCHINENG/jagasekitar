// Draws HazardZones as react-native-maps Polygons (one per polygon part, holes included).
import type { RiskLevel } from '@jagasekitar/shared';
import { riskRank } from '@jagasekitar/shared';
import type { MultiPolygon, Polygon as GeoPolygon, Position } from 'geojson';
import { Fragment } from 'react';
import { Polygon } from 'react-native-maps';
import type { AppZone } from '@/lib/data';
import { zoneFill, zoneStroke } from '../risk';

type LatLng = { latitude: number; longitude: number };
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

export interface ZoneLayerProps {
  zones: AppZone[];
  /** 'hazard' uses each hazard's palette; 'neutral' draws subtle outlines (main map). */
  mode?: 'hazard' | 'neutral';
  onPress?: (zone: AppZone) => void;
  fillOverride?: (zone: AppZone) => string | undefined;
}

export function ZoneLayer({ zones, mode = 'hazard', onPress, fillOverride }: ZoneLayerProps) {
  // Low levels first so higher-risk polygons draw on top and win taps.
  const ordered = [...zones].sort((a, b) => riskRank(a.level) - riskRank(b.level));
  return (
    <>
      {ordered.map((zone) => (
        <Fragment key={`${zone.dbId}`}>
          {polygonParts(zone.geometry).map((part, i) => (
            <Polygon
              key={i}
              coordinates={part.outer}
              holes={part.holes.length ? part.holes : undefined}
              fillColor={
                fillOverride?.(zone) ??
                (mode === 'neutral'
                  ? zoneFill(zone.hazard, zone.level, '22')
                  : zoneFill(zone.hazard, zone.level))
              }
              strokeColor={zoneStroke(zone.hazard, zone.level)}
              strokeWidth={mode === 'neutral' ? 1.5 : levelStroke(zone.level)}
              tappable={!!onPress}
              onPress={() => onPress?.(zone)}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
}

const levelStroke = (level: RiskLevel) => (riskRank(level) >= riskRank('high') ? 2.5 : 1.5);
