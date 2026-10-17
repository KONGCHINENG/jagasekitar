// Open-Meteo (no key). Three feeds, all written to weather_grid:
//  - open_meteo:       1° wind grid over the haze bbox (smoke trajectories), every 3 h
//  - open_meteo_aq:    0.5° PM2.5/PM10 grid over Peninsular Malaysia (haze cross-check), every 3 h
//  - open_meteo_local: 0.25° rain-forecast grid over the default state (flood engine), hourly
// Free tier is ~10k location-calls/day; grid sizes are chosen to stay well inside it.
import { HAZE_BBOX } from '@jagasekitar/shared';
import { readFileSync } from 'node:fs';
import { cached } from '../../src/core/cache';
import { getSetting, upsertChunks } from '../../src/core/db';
import { fetchText } from '../../src/core/http';
import type { SourceContext, SourceDef } from '../../src/core/source';
import {
  AQ_VARS,
  FORECAST_VARS,
  chunk,
  gridPoints,
  parseHourly,
  toDbRow,
  type Bbox,
  type WeatherRow,
} from './parse';

export type { WeatherRow } from './parse';

const LOCATIONS_PER_REQUEST = 100;
const HOURS_BACK = 3;
const HOURS_AHEAD = 75;

const PENINSULA_BBOX: Bbox = [99.5, 1, 104.5, 7];
// Rain-forecast grids per state; extend when adding states.
const STATE_BBOX: Record<string, Bbox> = {
  PRK: [100.3, 3.6, 101.9, 6.0],
};

interface Feed {
  name: string;
  baseUrl: string;
  bbox: (ctx: SourceContext) => Bbox;
  step: number;
  vars: Record<string, keyof WeatherRow>;
  ttlMs: number;
}

const FEEDS = {
  wind: {
    name: 'open_meteo',
    baseUrl: 'https://api.open-meteo.com/v1/forecast',
    bbox: () => HAZE_BBOX,
    step: 1,
    vars: {
      wind_speed_10m: FORECAST_VARS.wind_speed_10m,
      wind_direction_10m: FORECAST_VARS.wind_direction_10m,
      wind_speed_850hPa: FORECAST_VARS.wind_speed_850hPa,
      wind_direction_850hPa: FORECAST_VARS.wind_direction_850hPa,
    },
    ttlMs: 90 * 60_000,
  },
  airQuality: {
    name: 'open_meteo_aq',
    baseUrl: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    bbox: () => PENINSULA_BBOX,
    step: 0.5,
    vars: AQ_VARS,
    ttlMs: 90 * 60_000,
  },
  local: {
    name: 'open_meteo_local',
    baseUrl: 'https://api.open-meteo.com/v1/forecast',
    bbox: (ctx) => STATE_BBOX[ctx.state] ?? STATE_BBOX.PRK!,
    step: 0.25,
    vars: FORECAST_VARS,
    ttlMs: 30 * 60_000,
  },
} satisfies Record<string, Feed>;

function window(now: Date) {
  return {
    from: now.getTime() - HOURS_BACK * 3600_000,
    to: now.getTime() + HOURS_AHEAD * 3600_000,
  };
}

async function fetchFeed(feed: Feed, ctx: SourceContext): Promise<WeatherRow[]> {
  const points = gridPoints(feed.bbox(ctx), feed.step);
  const rows: WeatherRow[] = [];
  for (const batch of chunk(points, LOCATIONS_PER_REQUEST)) {
    const params = new URLSearchParams({
      latitude: batch.map((p) => p.lat).join(','),
      longitude: batch.map((p) => p.lon).join(','),
      hourly: Object.keys(feed.vars).join(','),
      forecast_days: '4',
      timezone: 'UTC',
    });
    const url = `${feed.baseUrl}?${params}`;
    const { body } = await cached(url, feed.ttlMs, () => fetchText(url, { timeoutMs: 45_000 }));
    rows.push(...parseHourly(JSON.parse(body), batch, feed.vars, window(ctx.now)));
  }
  return rows;
}

interface MockParams {
  wind: {
    dir850: number;
    speed850: number;
    dir10m: number;
    speed10m: number;
    dirVariationDeg: number;
  };
  precip: { baseMm: number; peakMm: number; peakHourUtc: number; prob: number };
  airQuality: {
    pm25Base: number;
    pm25Peak: number;
    plumeCentre: [number, number];
    plumeRadiusDeg: number;
  };
}

/** Synthetic but smooth fields so the engines and maps have something plausible to show. */
function mockFeed(feed: Feed, ctx: SourceContext): WeatherRow[] {
  const p = JSON.parse(readFileSync(new URL('./mock.json', import.meta.url), 'utf8')) as MockParams;
  const points = gridPoints(feed.bbox(ctx), feed.step);
  const start = Math.floor(ctx.now.getTime() / 3600_000) * 3600_000 - HOURS_BACK * 3600_000;
  const rows: WeatherRow[] = [];
  for (let h = 0; h <= HOURS_BACK + HOURS_AHEAD; h += feed.step >= 1 ? 3 : 1) {
    const t = start + h * 3600_000;
    const hourUtc = new Date(t).getUTCHours();
    for (const { lat, lon } of points) {
      const wobble = Math.sin(lat * 0.7 + lon * 0.3 + h / 12) * p.wind.dirVariationDeg;
      const row: WeatherRow = { lat, lon, validAt: new Date(t).toISOString() };
      for (const field of Object.values(feed.vars)) {
        switch (field) {
          case 'windDir850':
            row.windDir850 = (p.wind.dir850 + wobble + 360) % 360;
            break;
          case 'windSpeed850':
            row.windSpeed850 = p.wind.speed850 + 4 * Math.cos(lat + h / 8);
            break;
          case 'windDir10m':
            row.windDir10m = (p.wind.dir10m + wobble + 360) % 360;
            break;
          case 'windSpeed10m':
            row.windSpeed10m = p.wind.speed10m + 2 * Math.cos(lon + h / 6);
            break;
          case 'precip': {
            const diurnal = Math.max(
              0,
              Math.cos(((hourUtc - p.precip.peakHourUtc) / 24) * 2 * Math.PI),
            );
            row.precip = +(p.precip.baseMm + p.precip.peakMm * diurnal ** 4).toFixed(1);
            break;
          }
          case 'precipProb':
            row.precipProb = p.precip.prob;
            break;
          case 'pm2_5':
          case 'pm10': {
            const [cx, cy] = p.airQuality.plumeCentre;
            const d = Math.hypot(lon - cx, lat - cy) / p.airQuality.plumeRadiusDeg;
            const pm25 =
              p.airQuality.pm25Base +
              (p.airQuality.pm25Peak - p.airQuality.pm25Base) * Math.exp(-d * d);
            row[field] = +(field === 'pm2_5' ? pm25 : pm25 * 1.6).toFixed(1);
            break;
          }
        }
      }
      rows.push(row);
    }
  }
  return rows;
}

async function persist(records: WeatherRow[], ctx: SourceContext): Promise<number> {
  const written = await upsertChunks(
    ctx.db,
    'weather_grid',
    records.map(toDbRow),
    'lat,lon,valid_at',
  );
  const retention = await getSetting(ctx.db, 'retention_hours', { weather_grid: 6 });
  const cutoff = new Date(ctx.now.getTime() - retention.weather_grid * 3600_000).toISOString();
  const { error } = await ctx.db.from('weather_grid').delete().lt('valid_at', cutoff);
  if (error) throw new Error(`weather_grid prune failed: ${error.message}`);
  return written;
}

function sourceFor(feed: Feed): SourceDef<WeatherRow> {
  return {
    name: feed.name,
    fetch: (ctx) => fetchFeed(feed, ctx),
    mock: (ctx) => mockFeed(feed, ctx),
    persist,
  };
}

export const openMeteoWindSource = sourceFor(FEEDS.wind);
export const openMeteoAirQualitySource = sourceFor(FEEDS.airQuality);
export const openMeteoLocalSource = sourceFor(FEEDS.local);
