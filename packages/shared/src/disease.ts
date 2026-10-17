import { z } from 'zod';

export const DEFAULT_DISEASES = [
  { code: 'DENGUE', nameEn: 'Dengue', nameMs: 'Denggi', category: 'vector' },
  { code: 'LEPTO', nameEn: 'Leptospirosis', nameMs: 'Leptospirosis', category: 'water' },
  { code: 'CHOLERA', nameEn: 'Cholera', nameMs: 'Taun', category: 'water' },
  { code: 'TYPHOID', nameEn: 'Typhoid', nameMs: 'Kepialu', category: 'water' },
  {
    code: 'HFMD',
    nameEn: 'Hand-Foot-Mouth (HFMD)',
    nameMs: 'Penyakit Tangan, Kaki dan Mulut',
    category: 'contact',
  },
  {
    code: 'ILI',
    nameEn: 'Influenza-like illness',
    nameMs: 'Penyakit seperti influenza',
    category: 'respiratory',
  },
  {
    code: 'ARI',
    nameEn: 'Acute respiratory infection',
    nameMs: 'Jangkitan saluran pernafasan akut',
    category: 'respiratory',
  },
  { code: 'CONJ', nameEn: 'Conjunctivitis', nameMs: 'Konjunktivitis', category: 'contact' },
  {
    code: 'DIARR',
    nameEn: 'Diarrhoeal disease',
    nameMs: 'Penyakit cirit-birit',
    category: 'water',
  },
  { code: 'COVID19', nameEn: 'COVID-19', nameMs: 'COVID-19', category: 'respiratory' },
] as const;

/**
 * Aggregate case report — counts only. There is deliberately no field for patient
 * names, IC numbers or any other personal data, and `.strict()` rejects extra keys.
 */
export const caseReportInputSchema = z
  .object({
    facilityId: z.uuid(),
    diseaseCode: z.string().min(1),
    reportDate: z.iso.date(),
    newCases: z.number().int().min(0).max(10000),
    suspectedCases: z.number().int().min(0).max(10000).default(0),
    notes: z.string().max(500).optional(),
  })
  .strict();

export type CaseReportInput = z.infer<typeof caseReportInputSchema>;
