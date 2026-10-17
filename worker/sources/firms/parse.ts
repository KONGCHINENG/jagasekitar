// NASA FIRMS area CSV → normalized hotspots. Columns are found by header name, so VIIRS
// (bright_ti4, confidence l/n/h) and MODIS (brightness, confidence 0–100) both parse.

export interface FireHotspot {
  source: string; // VIIRS_SNPP_NRT | VIIRS_NOAA20_NRT | MODIS_NRT | demo
  lat: number;
  lon: number;
  brightness: number | null;
  frp: number | null; // MW
  confidence: 'l' | 'n' | 'h';
  acquiredAt: string; // ISO UTC
}

/** MODIS reports 0–100; bucket it like VIIRS (low < 30 ≤ nominal < 80 ≤ high). */
export function normalizeConfidence(raw: string): 'l' | 'n' | 'h' {
  const v = raw.trim().toLowerCase();
  if (v === 'l' || v === 'low') return 'l';
  if (v === 'h' || v === 'high') return 'h';
  if (v === 'n' || v === 'nominal') return 'n';
  const n = Number(v);
  if (Number.isNaN(n)) return 'n';
  return n < 30 ? 'l' : n < 80 ? 'n' : 'h';
}

export function parseFirmsCsv(csv: string, source: string): FireHotspot[] {
  const lines = csv.trim().split(/\r?\n/);
  const header =
    lines
      .shift()
      ?.split(',')
      .map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const iLat = col('latitude');
  const iLon = col('longitude');
  const iDate = col('acq_date');
  const iTime = col('acq_time');
  if (iLat < 0 || iLon < 0 || iDate < 0 || iTime < 0) {
    // FIRMS returns plain-text errors (e.g. "Invalid MAP_KEY") with HTTP 200.
    throw new Error(`Unexpected FIRMS response: ${csv.slice(0, 120)}`);
  }
  const iBright = col('bright_ti4') >= 0 ? col('bright_ti4') : col('brightness');
  const iFrp = col('frp');
  const iConf = col('confidence');

  const out: FireHotspot[] = [];
  for (const line of lines) {
    const c = line.split(',');
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    const date = c[iDate]?.trim();
    const hhmm = (c[iTime] ?? '').trim().padStart(4, '0');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !date) continue;
    const num = (i: number) => {
      const v = Number(c[i]);
      return i >= 0 && Number.isFinite(v) ? v : null;
    };
    out.push({
      source,
      lat,
      lon,
      brightness: num(iBright),
      frp: num(iFrp),
      confidence: normalizeConfidence(c[iConf] ?? ''),
      acquiredAt: `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`,
    });
  }
  return out;
}
