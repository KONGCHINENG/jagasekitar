/** Small geodesy helpers used by all engines. A spherical earth is accurate enough here. */
export const EARTH_RADIUS_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Meteorological wind direction is where the wind comes FROM.
 * The bearing the air (and smoke) travels TOWARDS is the opposite.
 */
export function windToBearing(windFromDeg: number): number {
  return (((windFromDeg + 180) % 360) + 360) % 360;
}

/** Move a point `distKm` along `bearingDeg` (0 = north, 90 = east). Returns [lat, lon]. */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distKm: number,
): [number, number] {
  const delta = distKm / EARTH_RADIUS_KM;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );
  return [toDeg(phi2), ((toDeg(lambda2) + 540) % 360) - 180];
}
