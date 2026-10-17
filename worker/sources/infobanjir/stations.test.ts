import { describe, expect, it } from 'vitest';
import { trendFor } from './index';
import { geocodeName } from './stations';

describe('geocodeName', () => {
  it('uses the place after "di" and expands abbreviations', () => {
    expect(geocodeName('Sg. Kerian di Kg. Kebun Baru (F2)')).toBe('Kampung Kebun Baru');
    expect(geocodeName('Sg. Rui di Jam. Jln. Raya Perak (RHN)')).toBe('Jambatan Jalan Raya Perak');
  });
  it('expands school prefixes and drops suffixes', () => {
    expect(geocodeName('S. K. Matang (F2)')).toBe('Sekolah Kebangsaan Matang');
    expect(geocodeName('Emp. Ulu Kinta (RHN)')).toBe('Empangan Ulu Kinta');
  });
});

describe('trendFor', () => {
  it('uses a ±2 cm dead band', () => {
    expect(trendFor(10.5, 10.4)).toBe('rising');
    expect(trendFor(10.4, 10.5)).toBe('falling');
    expect(trendFor(10.41, 10.4)).toBe('steady');
    expect(trendFor(10.4, undefined)).toBe('steady');
  });
});
