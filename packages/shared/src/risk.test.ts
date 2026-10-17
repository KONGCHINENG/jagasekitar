import { describe, expect, it } from 'vitest';
import { caseReportInputSchema } from './disease';
import { atLeast, maxRisk } from './risk';

describe('risk helpers', () => {
  it('maxRisk picks the highest level', () => {
    expect(maxRisk('low', 'severe', 'moderate')).toBe('severe');
    expect(maxRisk()).toBe('none');
  });
  it('atLeast compares by rank', () => {
    expect(atLeast('high', 'moderate')).toBe(true);
    expect(atLeast('low', 'moderate')).toBe(false);
  });
});

describe('caseReportInputSchema', () => {
  const base = {
    facilityId: '7b1f7d4e-2a8c-4f4e-9a51-0c7c2f5b9a10',
    diseaseCode: 'DENGUE',
    reportDate: '2026-10-17',
    newCases: 4,
  };
  it('accepts aggregate counts', () => {
    expect(caseReportInputSchema.parse(base).suspectedCases).toBe(0);
  });
  it('rejects negative counts and extra personal fields', () => {
    expect(caseReportInputSchema.safeParse({ ...base, newCases: -1 }).success).toBe(false);
    expect(caseReportInputSchema.safeParse({ ...base, patientName: 'Ali' }).success).toBe(false);
  });
});
