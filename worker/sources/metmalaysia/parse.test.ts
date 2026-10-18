// Parser tests: a real response saved from api.data.gov.my on 2026-10-18, plus crafted texts for
// the district matching rules.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coveredDistricts, myt, parseWarnings, stateMentions, warningKind } from './parse';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

const PERAK = [
  'Bagan Datuk',
  'Batang Padang',
  'Hilir Perak',
  'Hulu Perak',
  'Kampar',
  'Kerian',
  'Kuala Kangsar',
  'Kinta',
  'Larut Matang dan Selama',
  'Manjung',
  'Muallim',
  'Perak Tengah',
];

describe('warningKind', () => {
  it('classifies MetMalaysia titles in English and Malay', () => {
    expect(warningKind('Thunderstorms Warning', 'Amaran Ribut Petir')).toBe('thunderstorm');
    expect(
      warningKind('Continuous Rain Warning (Alert Level)', 'Amaran Hujan Berterusan (Waspada)'),
    ).toBe('rain_alert');
    expect(warningKind('Continuous Rain Warning (Bad Weather)', 'Hujan Berterusan (Buruk)')).toBe(
      'rain_bad',
    );
    expect(warningKind('Continuous Rain Warning (Danger)', 'Hujan Berterusan (Bahaya)')).toBe(
      'rain_danger',
    );
    expect(warningKind('Strong Winds and Rough Seas Warning', 'Amaran Angin Kencang')).toBe(
      'other',
    );
  });
});

describe('district matching', () => {
  it('reads Malaysia local time', () => {
    expect(myt('2026-10-18T11:00:00')).toBe('2026-10-18T03:00:00.000Z');
  });

  it('ignores Hulu/Hilir Perak and the state name inside other brackets', () => {
    expect(stateMentions('over Kedah (Langkawi) • Pahang (Hulu Perak)', 'Perak')).toEqual([]);
    expect(stateMentions('over Perak (Kinta and Kampar) • Kedah', 'Perak')).toEqual([
      'Kinta and Kampar',
    ]);
    expect(stateMentions('over the states of Perlis • Perak • Kedah', 'Perak')).toEqual(['']);
  });

  it('matches districts, including multi-part names', () => {
    const text =
      'Thunderstorms are expected over the states of Perak (Kerian, Larut, Matang & Selama and Hulu Perak) • Kedah (Kulim)';
    expect(coveredDistricts(text, 'Perak', PERAK)).toEqual([
      'Hulu Perak',
      'Kerian',
      'Larut Matang dan Selama',
    ]);
  });

  it('treats a bare state name as every district', () => {
    expect(coveredDistricts('Continuous rain over Perak until 6 PM', 'Perak', PERAK)).toEqual(
      PERAK,
    );
  });

  it('returns nothing when the state is not named', () => {
    expect(coveredDistricts('over Kelantan (Tumpat)', 'Perak', PERAK)).toEqual([]);
  });
});

describe('parseWarnings', () => {
  it('parses the live feed and finds no Perak districts in it', () => {
    const warnings = parseWarnings(fixture('warnings-2026-10-18.json'), 'Perak', PERAK);
    const storm = warnings.find((w) => w.kind === 'thunderstorm');
    expect(storm).toMatchObject({
      level: 'low',
      titleMs: 'Amaran Ribut Petir',
      validTo: '2026-10-18T07:00:00.000Z',
      districts: [],
    });
    // Marine warnings mention Perak's waters but are not land rain warnings.
    expect(warnings.filter((w) => w.kind === 'other').every((w) => !w.districts.length)).toBe(true);
    expect(warnings.some((w) => /no advisory/i.test(w.titleEn))).toBe(false);
  });

  it('rejects a response that is not a list', () => {
    expect(() => parseWarnings('{"error":"x"}', 'Perak', PERAK)).toThrow();
  });
});
