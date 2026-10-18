// World Air Quality Index (aqicn.org / waqi.info) JSON API. It republishes Malaysia's DOE
// (APIMS) stations. Two calls: the stations inside a box, then each station's feed for its PM2.5
// sub-index. WAQI publishes US-EPA AQI numbers, not concentrations; we convert PM2.5 back to
// µg/m³ with the EPA 2024 breakpoints so it can sit next to the model's PM2.5 (approximate).

export interface AirQualityObs {
  uid: string;
  source: 'waqi' | 'mock';
  name: string;
  lat: number;
  lon: number;
  pm25: number | null;
  aqi: number | null;
  observedAt: string;
  /** Official monitor (positive WAQI id) rather than a community sensor (negative id). */
  official: boolean;
}

export interface BoundsStation {
  uid: number;
  lat: number;
  lon: number;
  aqi: number | null;
  name: string;
}

interface WaqiResponse<T> {
  status?: string;
  data?: T | string;
}

function unwrap<T>(json: string): T {
  const res = JSON.parse(json) as WaqiResponse<T>;
  if (res.status !== 'ok' || res.data == null || typeof res.data === 'string') {
    throw new Error(`WAQI: ${typeof res.data === 'string' ? res.data : 'unexpected response'}`);
  }
  return res.data;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** /v2/map/bounds → stations with a current reading. */
export function parseBounds(json: string): BoundsStation[] {
  const rows = unwrap<
    {
      uid?: number;
      lat?: number;
      lon?: number;
      aqi?: string | number;
      station?: { name?: string };
    }[]
  >(json);
  return rows
    .filter((r) => r.uid != null && r.lat != null && r.lon != null)
    .map((r) => ({
      uid: r.uid!,
      lat: r.lat!,
      lon: r.lon!,
      aqi: num(r.aqi),
      name: r.station?.name?.trim() || `Station ${r.uid}`,
    }))
    .filter((r) => r.aqi != null);
}

/** /feed/@uid/ → one observation. */
export function parseFeed(json: string, fallback: BoundsStation): AirQualityObs {
  const d = unwrap<{
    aqi?: number | string;
    city?: { geo?: [number, number]; name?: string };
    iaqi?: { pm25?: { v?: number } };
    time?: { iso?: string };
  }>(json);
  const pm25Aqi = num(d.iaqi?.pm25?.v);
  const observed = d.time?.iso ? Date.parse(d.time.iso) : NaN;
  if (Number.isNaN(observed)) throw new Error(`WAQI: station ${fallback.uid} has no time`);
  return {
    uid: `waqi:${fallback.uid}`,
    source: 'waqi',
    name: d.city?.name?.trim() || fallback.name,
    lat: d.city?.geo?.[0] ?? fallback.lat,
    lon: d.city?.geo?.[1] ?? fallback.lon,
    pm25: pm25Aqi == null ? null : aqiToPm25(pm25Aqi),
    aqi: num(d.aqi) ?? fallback.aqi,
    observedAt: new Date(observed).toISOString(),
    official: fallback.uid > 0,
  };
}

// US EPA PM2.5 breakpoints (2024 revision): [AQI low, AQI high, µg/m³ low, µg/m³ high].
const PM25_BREAKPOINTS: [number, number, number, number][] = [
  [0, 50, 0, 9],
  [51, 100, 9.1, 35.4],
  [101, 150, 35.5, 55.4],
  [151, 200, 55.5, 125.4],
  [201, 300, 125.5, 225.4],
  [301, 500, 225.5, 325.4],
];

/** PM2.5 AQI sub-index → µg/m³ (linear inside each EPA band). */
export function aqiToPm25(aqi: number): number {
  const a = Math.max(0, aqi);
  const band =
    PM25_BREAKPOINTS.find(([lo, hi]) => a >= lo && a <= hi) ??
    (a > 500 ? PM25_BREAKPOINTS.at(-1)! : PM25_BREAKPOINTS.find(([, hi]) => a < hi + 1)!);
  const [ilo, ihi, clo, chi] = band;
  const c = ((Math.min(a, ihi) - ilo) * (chi - clo)) / (ihi - ilo) + clo;
  return Math.round(c * 10) / 10;
}
