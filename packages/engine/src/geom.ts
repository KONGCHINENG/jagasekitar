// Geometry glue around Turf. All outputs are Polygon | MultiPolygon in [lon, lat] order.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import circle from '@turf/circle';
import { featureCollection, feature, point } from '@turf/helpers';
import intersect from '@turf/intersect';
import union from '@turf/union';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

export type Area = Polygon | MultiPolygon;

export function circleArea(lat: number, lon: number, radiusKm: number, steps = 32): Polygon {
  return circle([lon, lat], radiusKm, { steps, units: 'kilometers' }).geometry;
}

/** Union of many areas; null if the list is empty. */
export function unionAll(areas: Area[]): Area | null {
  if (areas.length === 0) return null;
  if (areas.length === 1) return areas[0]!;
  const merged = union(featureCollection(areas.map((a) => feature(a))));
  return merged?.geometry ?? null;
}

export function intersectAreas(a: Area, b: Area): Area | null {
  const hit = intersect(featureCollection([feature(a), feature(b)]));
  return hit?.geometry ?? null;
}

export function pointInArea(lat: number, lon: number, area: Area): boolean {
  return booleanPointInPolygon(point([lon, lat]), area as Polygon | MultiPolygon);
}

export function toMulti(area: Area): MultiPolygon {
  return area.type === 'MultiPolygon'
    ? area
    : { type: 'MultiPolygon', coordinates: [area.coordinates] };
}

export function asFeature(area: Area): Feature<Area> {
  return feature(area);
}

/** Bounding box [W, S, E, N] of an area. */
export function areaBbox(area: Area): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const polys = area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
  for (const poly of polys) {
    for (const [lon, lat] of poly[0] ?? []) {
      w = Math.min(w, lon!);
      e = Math.max(e, lon!);
      s = Math.min(s, lat!);
      n = Math.max(n, lat!);
    }
  }
  return [w, s, e, n];
}
