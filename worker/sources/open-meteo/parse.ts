// Open-Meteo helpers: sampling grids and turning multi-location responses into rows.

export interface WeatherRow {
  lat: number;
  lon: number;
  validAt: string; // ISO UTC
  windSpeed10m?: number | null; // km/h
  windDir10m?: number | null; // degrees FROM
  windSpeed850?: number | null;
  windDir850?: number | null;
  precip?: number | null; // mm in the hour
  precipProb?: number | null; // %
  pm2_5?: number | null; // µg/m³
  pm10?: number | null;
}

export type Bbox = readonly [west: number, south: number, east: number, north: number];

/** Grid points (inclusive) over a bbox, rounded to avoid float drift in unique keys. */
export function gridPoints(bbox: Bbox, step: number): { lat: number; lon: number }[] {
  const [w, s, e, n] = bbox;
  const pts: { lat: number; lon: number }[] = [];
  const round = (v: number) => Math.round(v * 1000) / 1000;
  for (let lat = s; lat <= n + 1e-9; lat += step) {
    for (let lon = w; lon <= e + 1e-9; lon += step) pts.push({ lat: round(lat), lon: round(lon) });
  }
  return pts;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Response variable → WeatherRow field. */
export const FORECAST_VARS = {
  wind_speed_10m: 'windSpeed10m',
  wind_direction_10m: 'windDir10m',
  wind_speed_850hPa: 'windSpeed850',
  wind_direction_850hPa: 'windDir850',
  precipitation: 'precip',
  precipitation_probability: 'precipProb',
} as const satisfies Record<string, keyof WeatherRow>;

export const AQ_VARS = { pm2_5: 'pm2_5', pm10: 'pm10' } as const satisfies Record<
  string,
  keyof WeatherRow
>;

interface OpenMeteoLocation {
  hourly?: Record<string, (number | null)[] | string[]> & { time: string[] };
}

/**
 * Open-Meteo returns one object per requested location, in request order (or a single object for
 * one location). We key rows by the *requested* coordinates: the response's lat/lon are snapped
 * to the model grid and would break the (lat, lon, valid_at) unique key.
 */
export function parseHourly(
  body: unknown,
  points: { lat: number; lon: number }[],
  vars: Record<string, keyof WeatherRow>,
  window: { from: number; to: number },
): WeatherRow[] {
  const locations = (Array.isArray(body) ? body : [body]) as OpenMeteoLocation[];
  if (locations.length !== points.length) {
    throw new Error(`Open-Meteo returned ${locations.length} locations, expected ${points.length}`);
  }
  const rows: WeatherRow[] = [];
  locations.forEach((loc, i) => {
    const hourly = loc.hourly;
    if (!hourly?.time) throw new Error('Open-Meteo response has no hourly data');
    const { lat, lon } = points[i]!;
    hourly.time.forEach((t, h) => {
      // Requested with timezone=UTC, times look like 2026-10-17T06:00.
      const ms = Date.parse(`${t}:00Z`);
      if (ms < window.from || ms > window.to) return;
      const row: WeatherRow = { lat, lon, validAt: new Date(ms).toISOString() };
      for (const [apiName, field] of Object.entries(vars)) {
        const v = (hourly[apiName] as (number | null)[] | undefined)?.[h];
        (row[field] as number | null) = typeof v === 'number' ? v : null;
      }
      rows.push(row);
    });
  });
  return rows;
}

export function toDbRow(r: WeatherRow): Record<string, unknown> {
  const row: Record<string, unknown> = { lat: r.lat, lon: r.lon, valid_at: r.validAt };
  const map: [keyof WeatherRow, string][] = [
    ['windSpeed10m', 'wind_speed_10m'],
    ['windDir10m', 'wind_dir_10m'],
    ['windSpeed850', 'wind_speed_850'],
    ['windDir850', 'wind_dir_850'],
    ['precip', 'precip'],
    ['precipProb', 'precip_prob'],
    ['pm2_5', 'pm2_5'],
    ['pm10', 'pm10'],
  ];
  // Only send fields this feed provides, so an AQ upsert doesn't null out wind columns.
  for (const [field, col] of map) if (field in r) row[col] = r[field];
  return row;
}
