import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineKm, windToBearing } from './geo';

describe('windToBearing', () => {
  it('converts "from" direction to travel bearing', () => {
    expect(windToBearing(225)).toBe(45); // SW wind carries smoke NE
    expect(windToBearing(0)).toBe(180);
    expect(windToBearing(360)).toBe(180);
  });
});

describe('destinationPoint', () => {
  it('moves ~111 km per degree of latitude northwards', () => {
    const [lat, lon] = destinationPoint(4, 101, 0, 111.19);
    expect(lat).toBeCloseTo(5, 2);
    expect(lon).toBeCloseTo(101, 6);
  });
  it('round-trips with haversine', () => {
    const [lat, lon] = destinationPoint(0.5, 101.4, 45, 300);
    expect(haversineKm(0.5, 101.4, lat, lon)).toBeCloseTo(300, 3);
  });
});
