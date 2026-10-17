// Coarse named regions for "why" text ("fire hotspots in Riau, Sumatra"). Boxes are approximate
// and checked in order, so smaller regions come before the larger ones that contain them.
interface Region {
  name: string;
  bbox: [number, number, number, number]; // W, S, E, N
}

const REGIONS: Region[] = [
  { name: 'Riau, Sumatra', bbox: [100.35, -1.2, 104.5, 2.6] },
  { name: 'Jambi, Sumatra', bbox: [101.1, -2.8, 104.5, -0.7] },
  { name: 'South Sumatra', bbox: [102.0, -5.0, 106.2, -1.6] },
  { name: 'North Sumatra', bbox: [97.0, 0.5, 100.4, 4.3] },
  { name: 'West Sumatra', bbox: [98.5, -3.4, 101.9, 1.0] },
  { name: 'Aceh, Sumatra', bbox: [95.0, 2.0, 98.3, 6.1] },
  { name: 'Lampung, Sumatra', bbox: [103.5, -6.0, 106.0, -3.7] },
  { name: 'West Kalimantan', bbox: [108.6, -3.1, 114.2, 2.1] },
  { name: 'Central Kalimantan', bbox: [110.7, -3.6, 115.9, 0.8] },
  { name: 'South Kalimantan', bbox: [114.3, -4.2, 116.6, -1.3] },
  { name: 'East Kalimantan', bbox: [113.8, -2.4, 119.0, 4.4] },
  { name: 'Sarawak', bbox: [109.5, 0.8, 115.7, 5.1] },
  { name: 'Sabah', bbox: [115.3, 4.0, 119.3, 7.4] },
  { name: 'Peninsular Malaysia', bbox: [99.6, 1.2, 104.6, 6.8] },
];

export function regionName(lat: number, lon: number): string {
  const hit = REGIONS.find(
    ({ bbox: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n,
  );
  return hit?.name ?? `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`;
}

const REGION_MS: [string, string][] = [
  ['North Sumatra', 'Sumatera Utara'],
  ['South Sumatra', 'Sumatera Selatan'],
  ['West Sumatra', 'Sumatera Barat'],
  ['Sumatra', 'Sumatera'],
  ['West Kalimantan', 'Kalimantan Barat'],
  ['Central Kalimantan', 'Kalimantan Tengah'],
  ['South Kalimantan', 'Kalimantan Selatan'],
  ['East Kalimantan', 'Kalimantan Timur'],
  ['Peninsular Malaysia', 'Semenanjung Malaysia'],
];

export function regionNameMs(nameEn: string): string {
  for (const [en, ms] of REGION_MS) if (nameEn.includes(en)) return nameEn.replace(en, ms);
  return nameEn;
}

/** 16-point compass name for a travel bearing (0 = north). */
export function compass(bearing: number): string {
  const names = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return names[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16]!;
}

const COMPASS_MS: Record<string, string> = {
  N: 'utara',
  NNE: 'utara-timur laut',
  NE: 'timur laut',
  ENE: 'timur-timur laut',
  E: 'timur',
  ESE: 'timur-tenggara',
  SE: 'tenggara',
  SSE: 'selatan-tenggara',
  S: 'selatan',
  SSW: 'selatan-barat daya',
  SW: 'barat daya',
  WSW: 'barat-barat daya',
  W: 'barat',
  WNW: 'barat-barat laut',
  NW: 'barat laut',
  NNW: 'utara-barat laut',
};

export function compassMs(bearing: number): string {
  return COMPASS_MS[compass(bearing)]!;
}
