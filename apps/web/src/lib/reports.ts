// Pure helpers for case reporting: validation, CSV parsing, spike warnings, edit window.
// Shared by the entry grid, the CSV upload and the Server Actions (which re-validate everything).
import { z } from 'zod';

/** Malaysian IC (YYMMDD-PB-####) or any long digit run: same rule as the database CHECK. */
const PERSONAL_ID = /\d{6}-?\d{2}-?\d{4}|\d{9,}/;

export const MAX_BACKDATE_DAYS = 60;
export const EDIT_WINDOW_HOURS = 48;
export const DEFAULT_SPIKE_MULTIPLIER = 5;

export const reportRowSchema = z
  .object({
    reportDate: z.iso.date({ error: 'Date must be YYYY-MM-DD' }),
    diseaseCode: z.string().min(1, 'Choose a disease'),
    newCases: z.coerce
      .number({ error: 'Confirmed cases must be a number' })
      .int('Whole numbers only')
      .min(0, 'Cannot be negative')
      .max(10000),
    suspectedCases: z.coerce
      .number({ error: 'Suspected cases must be a number' })
      .int('Whole numbers only')
      .min(0, 'Cannot be negative')
      .max(10000),
    notes: z
      .string()
      .max(500, 'Notes are limited to 500 characters')
      .refine(
        (n) => !PERSONAL_ID.test(n),
        'Notes must not contain IC numbers, phone numbers or other personal data',
      )
      .optional()
      .transform((n) => (n?.trim() ? n.trim() : undefined)),
  })
  .strict();

export type ReportRow = z.infer<typeof reportRowSchema>;

export interface RowIssue {
  row: number; // 1-based
  message: string;
}

/** Malaysia-time calendar date (YYYY-MM-DD) for "today". */
export function todayMyt(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Validate rows; also checks dates, known disease codes and duplicate disease+date pairs. */
export function validateRows(
  input: unknown[],
  opts: { diseaseCodes: string[]; now?: Date },
): { rows: ReportRow[]; issues: RowIssue[] } {
  const today = todayMyt(opts.now);
  const rows: ReportRow[] = [];
  const issues: RowIssue[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const parsed = reportRowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) issues.push({ row: i + 1, message: issue.message });
      return;
    }
    const r = parsed.data;
    const age = daysBetween(r.reportDate, today);
    if (age < 0) issues.push({ row: i + 1, message: 'Date is in the future' });
    else if (age > MAX_BACKDATE_DAYS)
      issues.push({ row: i + 1, message: `Date is more than ${MAX_BACKDATE_DAYS} days ago` });
    if (!opts.diseaseCodes.includes(r.diseaseCode))
      issues.push({ row: i + 1, message: `Unknown disease code "${r.diseaseCode}"` });
    const key = `${r.reportDate}|${r.diseaseCode}`;
    if (seen.has(key)) issues.push({ row: i + 1, message: 'Same disease and date entered twice' });
    seen.add(key);
    rows.push(r);
  });
  return { rows, issues };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export const CSV_COLUMNS = [
  'report_date',
  'disease_code',
  'new_cases',
  'suspected_cases',
  'notes',
] as const;

export function csvTemplate(diseaseCodes: string[], today = todayMyt()): string {
  const example = diseaseCodes
    .slice(0, 2)
    .map((code, i) => `${today},${code},${i === 0 ? 3 : 0},${i === 0 ? 1 : 2},`);
  return [CSV_COLUMNS.join(','), ...example].join('\n') + '\n';
}

/** Split one CSV line, honouring double-quoted fields with "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse an upload into raw row objects for validateRows(). Columns are found by header name. */
export function parseCasesCsv(text: string): {
  raw: Record<string, unknown>[];
  issues: RowIssue[];
} {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines.shift() ?? '').map((h) => h.toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => c !== 'notes' && !header.includes(c));
  if (missing.length)
    return { raw: [], issues: [{ row: 0, message: `Missing column(s): ${missing.join(', ')}` }] };
  const col = (cells: string[], name: string) => cells[header.indexOf(name)] ?? '';
  const raw = lines.map((line) => {
    const cells = splitCsvLine(line);
    return {
      reportDate: col(cells, 'report_date'),
      diseaseCode: col(cells, 'disease_code').toUpperCase(),
      newCases: col(cells, 'new_cases'),
      suspectedCases: col(cells, 'suspected_cases') || '0',
      notes: header.includes('notes') ? col(cells, 'notes') : '',
    };
  });
  return { raw, issues: [] };
}

// ---------------------------------------------------------------------------
// Spike warnings and the edit window
// ---------------------------------------------------------------------------
/**
 * Rows whose confirmed cases exceed `multiplier` × the usual daily count (28-day average for that
 * disease at this facility, treated as at least 1/day so tiny baselines don't trigger on 1 case).
 */
export function spikeWarnings(
  rows: Pick<ReportRow, 'diseaseCode' | 'newCases'>[],
  usualDaily: Record<string, number>,
  multiplier = DEFAULT_SPIKE_MULTIPLIER,
): { diseaseCode: string; newCases: number; usual: number }[] {
  return rows
    .map((r) => ({
      diseaseCode: r.diseaseCode,
      newCases: r.newCases,
      usual: usualDaily[r.diseaseCode] ?? 0,
    }))
    .filter((r) => r.newCases > multiplier * Math.max(r.usual, 1));
}

export function canEditDirectly(
  createdAt: string,
  now = new Date(),
  windowHours = EDIT_WINDOW_HOURS,
): boolean {
  return now.getTime() - Date.parse(createdAt) < windowHours * 3600_000;
}
