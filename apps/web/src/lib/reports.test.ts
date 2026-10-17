import { describe, expect, it } from 'vitest';
import {
  canEditDirectly,
  csvTemplate,
  parseCasesCsv,
  spikeWarnings,
  todayMyt,
  validateRows,
} from './reports';

const NOW = new Date('2026-10-17T06:00:00Z'); // 14:00 in Malaysia
const CODES = ['DENGUE', 'LEPTO', 'ILI'];
const row = (over: Record<string, unknown> = {}) => ({
  reportDate: '2026-10-17',
  diseaseCode: 'DENGUE',
  newCases: 3,
  suspectedCases: 1,
  ...over,
});

describe('validateRows', () => {
  it('accepts aggregate counts and coerces form strings', () => {
    const { rows, issues } = validateRows(
      [row({ newCases: '4', suspectedCases: '0', notes: '  cluster near pasar  ' })],
      { diseaseCodes: CODES, now: NOW },
    );
    expect(issues).toEqual([]);
    expect(rows[0]).toEqual({
      reportDate: '2026-10-17',
      diseaseCode: 'DENGUE',
      newCases: 4,
      suspectedCases: 0,
      notes: 'cluster near pasar',
    });
  });

  it('rejects negatives, decimals, unknown codes and personal data', () => {
    const { issues } = validateRows(
      [
        row({ newCases: -1 }),
        row({ suspectedCases: 1.5, diseaseCode: 'LEPTO' }),
        row({ diseaseCode: 'FLU' }),
        row({ diseaseCode: 'ILI', notes: 'patient 850101-08-1234' }),
      ],
      { diseaseCodes: CODES, now: NOW },
    );
    expect(issues.map((i) => [i.row, i.message])).toEqual([
      [1, 'Cannot be negative'],
      [2, 'Whole numbers only'],
      [3, 'Unknown disease code "FLU"'],
      [4, 'Notes must not contain IC numbers, phone numbers or other personal data'],
    ]);
  });

  it('rejects patient-level extra fields', () => {
    const { issues } = validateRows([row({ patientName: 'Ali' })], {
      diseaseCodes: CODES,
      now: NOW,
    });
    expect(issues).toHaveLength(1);
  });

  it('checks dates against Malaysia time and flags duplicates', () => {
    expect(todayMyt(new Date('2026-10-17T17:00:00Z'))).toBe('2026-10-18'); // 01:00 MYT
    const { issues } = validateRows(
      [row({ reportDate: '2026-10-18' }), row({ reportDate: '2026-07-01' }), row(), row()],
      { diseaseCodes: CODES, now: NOW },
    );
    expect(issues.map((i) => i.message)).toEqual([
      'Date is in the future',
      'Date is more than 60 days ago',
      'Same disease and date entered twice',
    ]);
  });
});

describe('CSV', () => {
  it('round-trips the template', () => {
    const csv = csvTemplate(CODES, '2026-10-17');
    const { raw, issues } = parseCasesCsv(csv);
    expect(issues).toEqual([]);
    const v = validateRows(raw, { diseaseCodes: CODES, now: NOW });
    expect(v.issues).toEqual([]);
    expect(v.rows.map((r) => r.diseaseCode)).toEqual(['DENGUE', 'LEPTO']);
  });

  it('finds columns by name, handles quotes, BOM and lowercase codes', () => {
    const csv =
      '﻿notes,new_cases,disease_code,report_date,suspected_cases\r\n"near ""Taman"", Ipoh",2,dengue,2026-10-16,\r\n';
    const { raw } = parseCasesCsv(csv);
    expect(raw).toEqual([
      {
        reportDate: '2026-10-16',
        diseaseCode: 'DENGUE',
        newCases: '2',
        suspectedCases: '0',
        notes: 'near "Taman", Ipoh',
      },
    ]);
  });

  it('reports missing required columns', () => {
    expect(parseCasesCsv('date,disease\n2026-10-17,DENGUE').issues[0]!.message).toBe(
      'Missing column(s): report_date, disease_code, new_cases, suspected_cases',
    );
  });
});

describe('spikeWarnings', () => {
  it('warns above 5x the usual daily count, treating tiny baselines as 1/day', () => {
    const w = spikeWarnings(
      [
        { diseaseCode: 'DENGUE', newCases: 11 }, // usual 2 → limit 10
        { diseaseCode: 'LEPTO', newCases: 5 }, // usual 0.1 → limit 5 → ok
        { diseaseCode: 'ILI', newCases: 6 }, // no history → limit 5
      ],
      { DENGUE: 2, LEPTO: 0.1 },
    );
    expect(w.map((x) => x.diseaseCode)).toEqual(['DENGUE', 'ILI']);
  });
});

describe('canEditDirectly', () => {
  it('allows edits for 48 hours after submission', () => {
    expect(canEditDirectly('2026-10-15T07:00:00Z', NOW)).toBe(true);
    expect(canEditDirectly('2026-10-15T05:00:00Z', NOW)).toBe(false);
  });
});
