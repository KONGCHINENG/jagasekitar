# JagaSekitar

Multi-hazard early warning for Malaysia (starting with Perak): **haze** from forest-fire smoke
drift, **floods** from JPS Public Infobanjir rainfall and river levels, and **infectious-disease
hotspots** from aggregate hospital reports. Users get push alerts for their location and can
check risk at a destination and along the route.

> Predictions are estimates. Always follow official advice from JPS, MetMalaysia, NADMA and KKM.

## Status

| Phase | What                                                       | State   |
| ----- | ---------------------------------------------------------- | ------- |
| 1     | Scaffold: monorepo, Expo app, Next.js app, shared + engine | ✅ Done |
| 2     | Database: migrations, PostGIS, RLS, seed                   | ✅ Done |
| 3     | Data adapters + worker (FIRMS, Open-Meteo, Infobanjir)     | ✅ Done |
| 4     | Prediction engines + tests                                 | ✅ Done |
| 5–6   | User app: maps, location, destination, notifications       | ⏳      |
| 7–8   | Hospital portal, admin panel                               | ⏳      |
| 9–10  | Demo mode polish, hardening, docs                          | ⏳      |

## Repo layout

```
apps/mobile        Expo (SDK 58) user app, Expo Router
apps/web           Next.js 16 hospital (/hospital) + admin (/admin) portal, Tailwind
packages/shared    Shared types, risk levels, colour tokens, zod schemas
packages/engine    Prediction logic (pure functions + Vitest tests)
worker             Data ingestion jobs
supabase           Supabase config, migrations, seed, DB tests (PGlite + PostGIS)
```

npm workspaces; workspace packages ship TypeScript source (no build step).

## Requirements

- **Node.js 22.13+** (Expo SDK 58 and Vitest 5 need it). Node 22 LTS recommended.
- npm 10+
- A free [Supabase](https://supabase.com) cloud project (from Phase 2)
- Expo Go on your phone (SDK 58). Note: remote push notifications on **Android** need a
  development build, not Expo Go; iOS Expo Go works.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
```

## Database (Supabase cloud)

1. In the Supabase dashboard, enable **Anonymous sign-ins** (Authentication → Sign In / Providers).
   The app works without an account, using anonymous auth for each device.
2. Push the migrations and seed. `login` opens your browser; `link` asks for the database password:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npm run db:push
   ```

3. Create the demo admin and hospital-staff accounts (fill in the `DEMO_*` values in `.env` first):

   ```bash
   npm run seed:accounts
   ```

4. Optional: load the real district polygons (downloads geoBoundaries MYS ADM2, CC BY 4.0), then
   push again. Until you do, district lookups use district centroids.

   ```bash
   npm run seed:districts
   ```

What's in it:

- `migrations/…_schema.sql`: all tables from the spec, PostGIS `geography` columns, `updated_at`
  triggers, and a profile row for each new auth user.
- `migrations/…_rls.sql`: RLS on every table. Hazard and station data are public. Users see only
  their own devices, places and notifications. Hospital staff can read and write case reports only
  for their own verified facility, with edits allowed for 48 h. Admins have full access. Also adds
  a rate limit, an audit log trigger, and `delete_my_data()`.
- `migrations/…_views_rpc.sql`: `v_active_zones`, `v_disease_district_summary` (7-day count,
  ratio to the 28-day baseline, cases per 100k, 14-day trend), facility report counts, data
  freshness, the `zones_in_bbox()` RPC (simplified GeoJSON for the map viewport) and
  `district_at()`.
- `seed.sql` + `seed/stations.sql`: Perak districts and population, 12 facilities, 10 disease
  types, 26 starter stations (`SEED-*` placeholder IDs until the Phase 3 adapter loads real JPS
  IDs), default engine thresholds, and the data-source registry.
  Edit `seed/stations_perak.csv`, then run `npm run gen:stations -w @jagasekitar/db`.

`npm run test:db` applies the real migrations and seed to an in-process Postgres with PostGIS
(PGlite), with a small stand-in for Supabase auth, and tests RLS, views and RPCs. No Docker or cloud
project needed.

## Data worker

`npm run worker:once` runs every enabled source once. `npm run worker:dev` keeps running and
refreshes each source on its own interval, which is set in `data_source_status` (editable from the
admin panel later). Run a single source with `npm run worker:once -- --source=infobanjir_rain`.

| Source (`data_source_status`) | What                                                                  | Every  |
| ----------------------------- | --------------------------------------------------------------------- | ------ |
| `firms`                       | NASA FIRMS hotspots, VIIRS S-NPP / NOAA-20 + MODIS, last 2 days       | 3 h    |
| `open_meteo`                  | 1° wind grid (10 m + 850 hPa) over Sumatra–Borneo, now → +75 h        | 3 h    |
| `open_meteo_aq`               | 0.5° PM2.5 / PM10 grid over Peninsular Malaysia                       | 3 h    |
| `open_meteo_local`            | 0.25° rain-forecast grid over the default state (flood engine)        | 1 h    |
| `infobanjir_rain`             | JPS rainfall per station: 1/3/6/24/72 h, since midnight, 6 daily      | 15 min |
| `infobanjir_water_level`      | JPS river levels with official Normal/Alert/Warning/Danger thresholds | 15 min |
| `infobanjir_alerts`           | JPS current alerts (all states), with exact station coordinates       | 15 min |

Every adapter (`worker/sources/<name>/`) has a **timeout + retry with back-off**, a **file cache**
(`worker/.cache`, which also serves stale data if the network fails), and a **mock fallback**
(`mock.json`, with times shifted to "now" so the demo never looks stale). A failing source never
stops the others. Its outcome (live/mock, record count, last error, a sample payload) goes to
`data_source_status` for the admin overview. Set `USE_MOCKS=true` to run entirely offline.
While demo mode is on, the worker pauses live adapters.

**Infobanjir notes** (endpoints found by inspecting the site; saved responses live in
`worker/sources/infobanjir/fixtures/` for the parser tests):

- Rainfall: `/wp-content/themes/shapely/agency/searchresultrainfalldt1.php?state=PRK&district=ALL&station=ALL&loginStatus=0&language=1`
- Water level: `/index.php/aras-air/data-paras-air/aras-air-data/?state=PRK&district=ALL&station=ALL&lang=en`.
  Don't add `type=NEGERI`, or the endpoint returns "No Data".
- Alerts: `/wp-content/themes/enlighten/data/currentalert.json`
- The HTML is malformed, and the rainfall header has one more column than its rows. The parsers
  identify cells by their `data-th` labels and check the header labels they depend on, so a
  layout change fails loudly and the worker falls back to cache, then mock.
- Station coordinates are not published. They are resolved in this order: admin-set, then
  coordinates from the alert feed (exact), then a Nominatim geocode, then the JPS station-number
  grid cell (e.g. `5207406` → 5.2°N 100.7°E, about 5 km), then the district centroid.
  `coords_source` records which one was used. Geocoding needs a real contact in
  `NOMINATIM_USER_AGENT`.

FIRMS without `FIRMS_MAP_KEY` uses `firms/mock.json`: synthetic hotspots in Riau, Jambi, South
Sumatra and Kalimantan, tagged `source = 'mock'`. The FIRMS parser fixtures are hand-written in
the documented FIRMS CSV format, because no key was available when they were written.

## Prediction engines

`packages/engine` has pure functions (data in, `HazardZone[]` out) with Vitest tests. The worker
re-runs them after every ingest that wrote data, or on demand with `npm run predict`. Each run
replaces that hazard's zones atomically (`replace_hazard_zones`) and is logged in
`prediction_runs`. Every threshold comes from the admin-editable `settings` rows.

- **Haze** (`haze.ts`): hotspots are clustered (10 km, FRP-weighted), then emit smoke puffs every
  6 h from 48 h ago to +72 h. Puffs are carried hourly by a blend of 850 hPa and 10 m winds
  (meteorological "from" direction converted to travel bearing), spread and decay with age, and
  are summed on a 5 km grid over the Peninsula. The grid is contoured into risk bands for the
  slices now, +12h, +24h, +48h and +72h, each valid until the next slice. The Open-Meteo PM2.5
  forecast only adjusts confidence. Every simplifying assumption is listed at the top of the file.
- **Flood** (`flood.ts`): JPS water-level status, observed 1/3/72 h rain, the next-24 h forecast
  and official JPS alerts (always at least `high`) are scored per station by the rules in the
  spec. Stale gauges are ignored. Stations are buffered by level, clipped to their district, and
  merged per district and level.
- **Disease** (`disease.ts`): the 7-day count vs. the 28-day baseline, and cases per 100k. An
  outbreak needs count ≥ min and ratio ≥ 2×. Active flood or haze zones raise linked diseases one
  level, and the "why" text says so.
- **`assessPoint(lat, lon, zones, { time })`** (`assess.ts`) returns the worst level per hazard at
  that point and time, plus bilingual advice (EN/BM). The notification job, the "Your area" card
  and the destination check all use it.

## Run

| Command               | What                                           |
| --------------------- | ---------------------------------------------- |
| `npm run dev:web`     | Portal at http://localhost:3000                |
| `npm run dev:mobile`  | Expo dev server; scan the QR code with Expo Go |
| `npm run worker:once` | Run all data jobs once, then predictions       |
| `npm run worker:dev`  | Worker in watch mode                           |
| `npm run predict`     | Run the haze, flood and disease engines only   |
| `npm test`            | Unit tests (all workspaces)                    |
| `npm run typecheck`   | TypeScript strict checks (all workspaces)      |
| `npm run format`      | Prettier                                       |

## Environment variables

See [`.env.example`](.env.example). Never commit `.env`. `SUPABASE_SERVICE_ROLE_KEY` is for the
worker and server-side code only.
