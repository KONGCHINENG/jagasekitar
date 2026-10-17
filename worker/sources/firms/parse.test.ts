import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeConfidence, parseFirmsCsv } from './parse';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

describe('parseFirmsCsv', () => {
  it('parses VIIRS rows', () => {
    const rows = parseFirmsCsv(fixture('viirs-snpp.csv'), 'VIIRS_SNPP_NRT');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({
      source: 'VIIRS_SNPP_NRT',
      lat: 0.52011,
      lon: 101.45102,
      brightness: 367,
      frp: 27.9,
      confidence: 'h',
      acquiredAt: '2026-10-16T06:12:00Z',
    });
  });

  it('parses MODIS rows, padding 3-digit times and bucketing numeric confidence', () => {
    const rows = parseFirmsCsv(fixture('modis.csv'), 'MODIS_NRT');
    expect(rows.map((r) => r.confidence)).toEqual(['h', 'l']);
    expect(rows[0]!.acquiredAt).toBe('2026-10-16T03:16:00Z');
    expect(rows[0]!.brightness).toBe(321.4);
  });

  it('rejects FIRMS plain-text errors', () => {
    expect(() => parseFirmsCsv('Invalid MAP_KEY.', 'MODIS_NRT')).toThrow(/Unexpected FIRMS/);
  });

  it('returns no rows for a header-only CSV', () => {
    expect(parseFirmsCsv(fixture('modis.csv').split('\n')[0]!, 'MODIS_NRT')).toEqual([]);
  });
});

describe('normalizeConfidence', () => {
  it('maps numbers to l/n/h', () => {
    expect([
      normalizeConfidence('10'),
      normalizeConfidence('50'),
      normalizeConfidence('80'),
    ]).toEqual(['l', 'n', 'h']);
  });
});
