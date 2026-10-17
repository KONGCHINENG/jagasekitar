// Parsers for JPS Public Infobanjir (publicinfobanjir.water.gov.my).
//
// The rainfall/water-level pages are HTML fragments with malformed markup (stray </tr>, rows
// without <tr>, and a rainfall header with one more column than the rows). So we don't index
// cells by header position. We walk the <td>s in document order, start a row at each
// td[data-th="No"], and identify cells by their data-th labels. The header is only read for the
// daily-rainfall dates, and checked for the labels we rely on, so a layout change fails loudly
// (and the worker falls back to cached or mock data) instead of silently mis-mapping columns.
import { load, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

export interface RainReading {
  stationId: string;
  name: string;
  district: string | null;
  observedAt: string; // ISO
  rainSinceMidnight: number | null;
  rain1h: number | null;
  rain3h: number | null;
  rain6h: number | null;
  rain24h: number | null;
  rain72h: number | null;
  /** Daily totals for previous days, most recent first: [{date: 'YYYY-MM-DD', mm}] */
  daily: { date: string; mm: number | null }[];
  /** Set on mock-fallback records so the app can label them as simulated. */
  mock?: boolean;
}

export type WaterStatus = 'normal' | 'alert' | 'warning' | 'danger';

export interface WaterLevelReading {
  stationId: string;
  name: string;
  district: string | null;
  basin: string | null;
  river: string | null;
  observedAt: string;
  level: number;
  normal: number | null;
  alert: number | null;
  warning: number | null;
  danger: number | null;
  status: WaterStatus;
  mock?: boolean;
}

export interface OfficialAlert {
  stationId: string;
  stationName: string;
  state: string;
  district: string | null;
  lat: number | null;
  lon: number | null;
  level: 'moderate' | 'high' | 'severe';
  title: string;
  issuedAt: string;
  waterSeverity: string | null;
  rainSeverity: string | null;
  trend: string | null;
  rain1h: number | null;
  rain3h: number | null;
  rain24h: number | null;
}

export class InfobanjirLayoutError extends Error {}

/** "17/10/2026 14:30:00" or "17/10/2026 14:30" in Malaysia time (UTC+8) → ISO. */
export function parseMyDateTime(raw: string): string | null {
  const m = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = '0', mi = '0', s = '0'] = m;
  const iso = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${s.padStart(2, '0')}+08:00`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Numeric cell → number; "-", "", "N/A" and sentinel negatives (e.g. -9999) → null. */
export function num(raw: string | undefined): number | null {
  if (raw == null) return null;
  const v = Number(raw.replace(/,/g, '').trim());
  if (raw.trim() === '' || Number.isNaN(v) || v <= -999) return null;
  return v;
}

/** Feeds mix "27628", "5208001" and "5006021_ Kolam Air"; keep the leading digits. */
export function normalizeStationId(raw: string): string {
  const m = raw.trim().match(/^\d+/);
  return m ? m[0] : raw.trim();
}

/**
 * JPS 7-digit station numbers on the Peninsula encode a 0.1° grid cell: digits 1–2 are latitude
 * tenths, digits 3–4 are longitude tenths above 100°E (e.g. 5207406 → 5.2°N, 100.7°E).
 * Returns the cell centre, or null when the number doesn't look like one.
 */
export function jpsGridCoords(stationId: string): { lat: number; lon: number } | null {
  if (!/^\d{7}$/.test(stationId)) return null;
  const lat = Number(stationId.slice(0, 2)) / 10 + 0.05;
  const lon = 100 + Number(stationId.slice(2, 4)) / 10 + 0.05;
  if (lat < 1 || lat > 7 || lon < 99.5 || lon > 104.6) return null;
  return { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Group <td>s into rows, starting a new row at each data-th="No" cell. */
function rowsOf($: CheerioAPI): Element[][] {
  const rows: Element[][] = [];
  let current: Element[] | null = null;
  $('td').each((_, td) => {
    if ($(td).attr('data-th') === 'No') {
      current = [];
      rows.push(current);
    }
    current?.push(td);
  });
  return rows;
}

function assertHeader($: CheerioAPI, labels: string[], what: string): void {
  const header = clean($('th').text()).toLowerCase();
  const missing = labels.filter((l) => !header.includes(l.toLowerCase()));
  if (missing.length) {
    throw new InfobanjirLayoutError(`${what} layout changed: header missing ${missing.join(', ')}`);
  }
}

export function parseRainfall(html: string): RainReading[] {
  const $ = load(html);
  assertHeader(
    $,
    [
      'Station',
      'District',
      'Last Updated',
      'Daily Rainfall',
      'Total Rainfall',
      '1 Hour',
      '3 Hours',
      '24 Hours',
    ],
    'Rainfall',
  );

  // Previous-day columns: header cells holding a dd/mm/yyyy date, left to right (oldest first).
  // Kept as local calendar dates (not converted to UTC, which would shift them a day back).
  const dailyLabels = $('th')
    .toArray()
    .map((th) => clean($(th).text()))
    .filter((t) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t))
    .map((t) => {
      const [d, m, y] = t.split('/');
      return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
    });
  if (dailyLabels.length === 0)
    throw new InfobanjirLayoutError('Rainfall layout changed: no daily dates');

  const out: RainReading[] = [];
  for (const cells of rowsOf($)) {
    const byTh = (label: string) => cells.find((c) => $(c).attr('data-th') === label);
    const text = (el: Element | undefined) => (el ? clean($(el).text()) : '');

    const name = text(byTh('Station Name'));
    const updatedCell = byTh('Updated Date');
    const observedAt = parseMyDateTime(text(updatedCell));
    // The JPS station id lives in the rainfall-graph link (the Station ID cell is often empty).
    const link = cells.map((c) => $(c).find('a[href*="stationid="]').attr('href')).find(Boolean);
    const linkId = link?.match(/stationid=([^&'"\s]+)/)?.[1];
    const stationId = normalizeStationId(linkId ?? text(byTh('Station ID')));
    if (!name || !observedAt || !stationId) continue;

    // Daily totals: the unlabeled cells right after "Updated Date", one per header date.
    const start = cells.indexOf(updatedCell!) + 1;
    const dailyCells = cells.slice(start, start + dailyLabels.length);
    const midnightCell = cells[start + dailyLabels.length];
    const totals = cells.filter((c) => $(c).attr('data-th') === 'Status').map((c) => num(text(c)));
    if (totals.length < 5)
      throw new InfobanjirLayoutError(`Rainfall row "${name}" has ${totals.length} totals`);

    out.push({
      stationId,
      name,
      district: text(byTh('District')) || null,
      observedAt,
      rainSinceMidnight: num(text(midnightCell)),
      rain1h: totals[0] ?? null,
      rain3h: totals[1] ?? null,
      rain6h: totals[2] ?? null,
      rain24h: totals[3] ?? null,
      rain72h: totals[4] ?? null,
      daily: dailyLabels.map((date, i) => ({ date, mm: num(text(dailyCells[i])) })).reverse(),
    });
  }
  return out;
}

export function statusFor(
  level: number,
  t: { alert: number | null; warning: number | null; danger: number | null },
): WaterStatus {
  if (t.danger != null && level >= t.danger) return 'danger';
  if (t.warning != null && level >= t.warning) return 'warning';
  if (t.alert != null && level >= t.alert) return 'alert';
  return 'normal';
}

export function parseWaterLevel(html: string): WaterLevelReading[] {
  const $ = load(html);
  assertHeader(
    $,
    [
      'Station ID',
      'Station Name',
      'District',
      'Last Updated',
      'Water Level',
      'Alert',
      'Warning',
      'Danger',
    ],
    'Water level',
  );

  const out: WaterLevelReading[] = [];
  for (const cells of rowsOf($)) {
    // data-th labels carry odd suffixes ("Main Basin (mm)"), so match by prefix.
    const byTh = (prefix: string) =>
      cells.find((c) =>
        ($(c).attr('data-th') ?? '').toLowerCase().startsWith(prefix.toLowerCase()),
      );
    const text = (prefix: string) => {
      const el = byTh(prefix);
      return el ? clean($(el).text()) : '';
    };
    // Some rows have an empty Station ID cell; the water-level graph link still carries the id.
    const wlCell = byTh('wl');
    const linkId = (wlCell ? $(wlCell) : $())
      .find('a[href*="stationid="]')
      .attr('href')
      ?.match(/stationid=([^&'"\s]+)/)?.[1];
    const stationId = normalizeStationId(text('Station ID') || linkId || '');
    const observedAt = parseMyDateTime(text('Last Update'));
    const level = num(text('wl'));
    if (!stationId || !observedAt || level == null) continue;
    const thresholds = {
      normal: num(text('Normal')),
      alert: num(text('Alert')),
      warning: num(text('Warning')),
      danger: num(text('Danger')),
    };
    out.push({
      stationId,
      name: text('Station Name'),
      district: text('District') || null,
      basin: text('Main Basin') || null,
      river: text('Sub River Basin') || null,
      observedAt,
      level,
      ...thresholds,
      status: statusFor(level, thresholds),
    });
  }
  return out;
}

interface CurrentAlertRecord {
  station_id?: string;
  station_name?: string;
  district?: string;
  state?: string;
  latitude?: string;
  longitude?: string;
  wl_severity_level?: string;
  rf_severity_level?: string;
  trend?: string;
  rf1hour?: string;
  rf3hours?: string;
  rf24hours?: string;
  wl_date_time?: string;
  rf_date_time?: string;
}

const WL_LEVEL: Record<string, OfficialAlert['level']> = {
  alert: 'moderate',
  warning: 'high',
  danger: 'severe',
};
const RF_LEVEL: Record<string, OfficialAlert['level']> = {
  heavy: 'moderate',
  'very heavy': 'high',
};
const RANK = { moderate: 1, high: 2, severe: 3 } as const;

/** currentalert.json (all states) → alerts at Alert level or above, or heavy rain. */
export function parseCurrentAlerts(json: string): OfficialAlert[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) throw new InfobanjirLayoutError('currentalert.json is not an array');
  const out: OfficialAlert[] = [];
  for (const r of data as CurrentAlertRecord[]) {
    const wl = (r.wl_severity_level ?? '').trim().toLowerCase();
    const rf = (r.rf_severity_level ?? '').trim().toLowerCase();
    const levels = [WL_LEVEL[wl], RF_LEVEL[rf]].filter((l): l is OfficialAlert['level'] => !!l);
    if (!levels.length || !r.station_id) continue;
    const level = levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
    const issuedAt =
      parseMyDateTime(r.wl_date_time ?? '') ??
      parseMyDateTime(r.rf_date_time ?? '') ??
      new Date().toISOString();
    const lat = num(r.latitude);
    const lon = num(r.longitude);
    const name = clean((r.station_name ?? '').replace(/^\d+_\s*/, ''));
    const parts = [
      WL_LEVEL[wl] ? `Water level ${r.wl_severity_level}` : null,
      RF_LEVEL[rf] ? `${r.rf_severity_level} rain` : null,
    ].filter(Boolean);
    out.push({
      stationId: normalizeStationId(r.station_id),
      stationName: name,
      state: clean(r.state ?? ''),
      district: r.district ? clean(r.district) : null,
      lat: lat && Math.abs(lat) <= 90 ? lat : null,
      lon: lon && Math.abs(lon) <= 180 ? lon : null,
      level,
      title: `${parts.join(', ')} at ${name}`,
      issuedAt,
      waterSeverity: r.wl_severity_level?.trim() || null,
      rainSeverity: r.rf_severity_level?.trim() || null,
      trend: r.trend?.trim() || null,
      rain1h: num(r.rf1hour),
      rain3h: num(r.rf3hours),
      rain24h: num(r.rf24hours),
    });
  }
  return out;
}
