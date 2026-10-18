// MetMalaysia weather warnings, as republished on data.gov.my (api.data.gov.my/weather/warning/).
// The feed is a snapshot of what is active now. Land warnings name places like
//   "… over the states of Kedah (Langkawi) • Perak (Kerian, Larut, Matang & Selama) • Kelantan …"
// We keep the rain-related ones and work out which of our districts they cover.
import type { RiskLevel } from '@jagasekitar/shared';

export type WarningKind = 'thunderstorm' | 'rain_alert' | 'rain_bad' | 'rain_danger' | 'other';

export interface MetWarning {
  kind: WarningKind;
  level: RiskLevel;
  titleEn: string;
  titleMs: string;
  issuedAt: string;
  validFrom: string;
  validTo: string;
  /** Districts of the requested state this warning covers; empty if it doesn't touch the state. */
  districts: string[];
  textEn: string;
}

interface RawWarning {
  warning_issue?: { issued?: string; title_en?: string; title_bm?: string };
  valid_from?: string | null;
  valid_to?: string | null;
  text_en?: string | null;
}

/** Risk level each kind adds to a district (the flood engine shows it as a district-wide zone). */
export const WARNING_LEVEL: Record<WarningKind, RiskLevel> = {
  thunderstorm: 'low',
  rain_alert: 'moderate',
  rain_bad: 'high',
  rain_danger: 'severe',
  other: 'none',
};

export function warningKind(titleEn: string, titleMs: string): WarningKind {
  const t = `${titleEn} ${titleMs}`.toLowerCase();
  if (/sea|laut|tsunami|earthquake|gempa|wind|angin/.test(t) && !/rain|hujan|thunder|petir/.test(t))
    return 'other';
  if (/thunder|petir/.test(t)) return 'thunderstorm';
  if (/rain|hujan/.test(t)) {
    if (/danger|bahaya/.test(t)) return 'rain_danger';
    if (/bad|buruk|severe/.test(t)) return 'rain_bad';
    return 'rain_alert';
  }
  return 'other';
}

/** MetMalaysia times are Malaysia local time without an offset. */
export function myt(local: string | null | undefined): string | null {
  if (!local) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(local) ? local : `${local}+08:00`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/** Extra spellings MetMalaysia uses for some districts. */
const ALIASES: Record<string, string[]> = {
  'Larut Matang dan Selama': ['larut', 'matang', 'selama'],
  Kerian: ['kerian', 'krian'],
  'Bagan Datuk': ['bagan datuk', 'bagan datoh'],
};

/**
 * Where `state` is named at the top level of the text (not inside brackets, so "Hulu Perak" and
 * "Hilir Perak" don't count), return what follows in brackets: '' when the whole state is named.
 */
export function stateMentions(text: string, state: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(state, i)) {
      const before = text[i - 1] ?? ' ';
      const after = text[i + state.length] ?? ' ';
      if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) continue;
      // Words just before: "Hulu Perak" / "Hilir Perak" at top level are districts, not the state.
      if (/(hulu|hilir)\s+$/i.test(text.slice(Math.max(0, i - 7), i))) continue;
      let j = i + state.length;
      while (text[j] === ' ') j++;
      if (text[j] === '(') {
        const close = text.indexOf(')', j);
        out.push(close > j ? text.slice(j + 1, close) : '');
      } else {
        out.push('');
      }
      i += state.length - 1;
    }
  }
  return out;
}

/** Our district names covered by the warning text for `state`. */
export function coveredDistricts(text: string, state: string, districts: string[]): string[] {
  const mentions = stateMentions(text, state);
  if (!mentions.length) return [];
  // The whole state, or a list we can't match to any district: treat as the whole state.
  const found = new Set<string>();
  for (const m of mentions) {
    if (!m.trim()) return [...districts];
    const hay = norm(m);
    for (const d of districts) {
      const names = ALIASES[d] ?? [d];
      if (names.some((n) => hay.includes(norm(n)))) found.add(d);
    }
  }
  return found.size ? districts.filter((d) => found.has(d)) : [...districts];
}

export function parseWarnings(json: string, state: string, districts: string[]): MetWarning[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) throw new Error('MetMalaysia: expected an array of warnings');
  const out: MetWarning[] = [];
  for (const raw of data as RawWarning[]) {
    const titleEn = raw.warning_issue?.title_en?.trim() ?? '';
    const titleMs = raw.warning_issue?.title_bm?.trim() ?? titleEn;
    if (!titleEn || /no advisory/i.test(titleEn)) continue;
    const issuedAt = myt(raw.warning_issue?.issued);
    const validFrom = myt(raw.valid_from) ?? issuedAt;
    const validTo = myt(raw.valid_to);
    if (!issuedAt || !validFrom || !validTo) continue;
    const kind = warningKind(titleEn, titleMs);
    const text = raw.text_en ?? '';
    out.push({
      kind,
      level: WARNING_LEVEL[kind],
      titleEn,
      titleMs,
      issuedAt,
      validFrom,
      validTo,
      districts: kind === 'other' ? [] : coveredDistricts(text, state, districts),
      textEn: text,
    });
  }
  return out;
}
