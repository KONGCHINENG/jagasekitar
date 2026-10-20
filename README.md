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
| 5     | User app: main map, haze/flood/illness maps, zone sheet    | ✅ Done |
| 6     | User app: location, destination, notifications             | ✅ Done |
| 7     | Hospital portal                                            | ✅ Done |
| 8     | Admin panel (`/admin`)                                     | ✅ Done |
| 9     | Demo mode: replayable scenarios                            | ✅ Done |
| 10    | Hardening and docs                                         | ✅ Done |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data-flow diagram and design decisions, and
[PITCH_NOTES.md](PITCH_NOTES.md) for the pitch, the 3-minute demo script, limitations and the
built / mocked checklist. [TESTING.md](TESTING.md) is the step-by-step test workflow. [DATA_ACCURACY.md](DATA_ACCURACY.md) lists the data to add next to make flood and
haze predictions more accurate.

## Repo layout

```
apps/mobile        Expo (SDK 57) user app, Expo Router
apps/web           Next.js 16 hospital (/hospital) + admin (/admin) portal, Tailwind
packages/shared    Shared types, risk levels, colour tokens, zod schemas
packages/engine    Prediction logic (pure functions + Vitest tests)
worker             Data ingestion jobs
supabase           Supabase config, migrations, seed, DB tests (PGlite + PostGIS)
```

npm workspaces; workspace packages ship TypeScript source (no build step).

## Requirements

- **Node.js 22.13+** (Vitest 5 needs it). Node 22 or 24 LTS recommended.
- npm 10+
- A free [Supabase](https://supabase.com) cloud project (from Phase 2)
- Expo Go on your phone with **SDK 57** support (Expo Go → Settings → Supported SDK). Note: remote push notifications on **Android** need a
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
admin panel later). Run a single source with `npx tsx src/index.ts --once --source=glofas` from
`worker/` (npm swallows the `--source` flag when it goes through `npm run`).

| Source (`data_source_status`) | What                                                                  | Every  |
| ----------------------------- | --------------------------------------------------------------------- | ------ |
| `firms`                       | NASA FIRMS hotspots, VIIRS S-NPP / NOAA-20 + MODIS, last 2 days       | 3 h    |
| `open_meteo`                  | 1° wind grid (10 m + 850 hPa) over Sumatra–Borneo, now → +75 h        | 3 h    |
| `open_meteo_aq`               | 0.5° PM2.5 / PM10 grid over Peninsular Malaysia                       | 3 h    |
| `open_meteo_local`            | 0.25° rain-forecast grid over the default state (flood engine)        | 1 h    |
| `infobanjir_rain`             | JPS rainfall per station: 1/3/6/24/72 h, since midnight, 6 daily      | 15 min |
| `infobanjir_water_level`      | JPS river levels with official Normal/Alert/Warning/Danger thresholds | 15 min |
| `infobanjir_alerts`           | JPS current alerts (all states), with exact station coordinates       | 15 min |
| `metmalaysia`                 | MetMalaysia rain and thunderstorm warnings for the state's districts  | 30 min |
| `glofas`                      | GloFAS river-flow forecast per JPS gauge + 2/5/20-year return periods | 6 h    |
| `waqi`                        | Measured PM2.5 at DOE stations (WAQI); mock without `WAQI_TOKEN`      | 1 h    |

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
Sumatra and Kalimantan, tagged `source = 'mock'`. With the key, a run returns about 12,000 live
hotspots over two days, and the haze engine handles them in about 6 s.

**New sources** (all free):

- **MetMalaysia** (`api.data.gov.my/weather/warning/`, no key; the trailing slash matters). The
  feed lists what is active now. Land warnings name places like `Perak (Kerian, Larut, Matang &
Selama)`. The parser finds the state at the top level of the text (so "Hulu Perak" inside another
  state's brackets doesn't count) and matches our district names, with aliases. A bare state name
  means every district. Thunderstorm → low, continuous rain Alert/Bad/Danger → moderate/high/severe.
  Rows go to `official_alerts` with `source = 'metmalaysia'`. There is no mock: inventing an
  official warning would be worse than showing none.
- **GloFAS** (Open-Meteo Flood API, no key). For each JPS river gauge, the highest forecast day
  in the next 3 days is compared with that river's 2, 5 and 20-year return periods. These are
  quantiles of the annual maxima in the GloFAS reanalysis, 1995–2024, refetched monthly. An
  earlier version compared with the median of the past 92 days. On 2026-10-18 that put almost
  every gauge at 4–17× "normal", because those months were the dry season. Against return
  periods, every gauge was correctly below its 2-year flow.
- **WAQI** (`WAQI_TOKEN`, free from aqicn.org). It republishes the Department of Environment's
  (DOE) stations. WAQI gives US-EPA AQI numbers; PM2.5 is converted back to µg/m³ with the EPA
  2024 breakpoints (approximate). The PM2.5 sub-index is used, not the overall AQI (Seri Manjung
  read overall 95 but PM2.5 105 on 2026-10-18). On 2026-10-18 a run returned 19 stations around
  Perak, Penang, Kedah and south Thailand. Stations with a negative WAQI id are community sensors:
  they are shown on the map (round, dashed, labelled) but never create zones; only official
  monitors do (`air_quality_obs.official`). Without a token, five labelled sample stations are
  shown, and they never create zones either. Parser fixtures are real responses with the token
  scrubbed.

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
  **Measured air beats the model**: a live DOE station reading "unhealthy for sensitive groups" (over 35 µg/m³) or worse in the last 3 h
  adds a 15 km zone for "now" (unhealthy for sensitive groups → moderate, Very Unhealthy → high, Hazardous → severe).
- **Flood** (`flood.ts`): JPS water-level status, observed 1/3/72 h rain, the next-24 h forecast
  and official JPS alerts (always at least `high`) are scored per station by the rules in the
  spec. Stale gauges are ignored. Stations are buffered by level, clipped to their district, and
  merged per district and level. A **MetMalaysia warning** covers the whole district it names, at
  its own level, until it expires. A **GloFAS forecast** reaching a river's 2/5/20-year flow gives
  moderate/high/high at the gauge (`river_flow_levels`; capped at high because a ~5 km cell may not
  sit on the gauge's exact river). Cells whose 2-year flow is under 2 m³/s are ignored.
- **Disease** (`disease.ts`): the 7-day count vs. the 28-day baseline, and cases per 100k. An
  outbreak needs count ≥ min and ratio ≥ 2×. Active flood or haze zones raise linked diseases one
  level, and the "why" text says so.
- **`assessPoint(lat, lon, zones, { time })`** (`assess.ts`) returns the worst level per hazard at
  that point and time, plus bilingual advice (EN/BM). The notification job, the "Your area" card
  and the destination check all use it.

## User app (Expo)

`apps/mobile` uses Expo SDK 57 and Expo Router, and runs in **Expo Go**. (It was built on SDK 58 and moved back to 57 because the store version of Expo Go only supports 57. To upgrade later: `npx expo install expo@^58 --fix` in `apps/mobile`, update the root `overrides` in `package.json`, and switch the tabs import back to `expo-router/native-tabs`.)

```bash
npm run dev:mobile
```

Scan the QR code with Expo Go. The phone must be on the same Wi-Fi as the PC; if it can't
connect, run `npx expo start --tunnel` from `apps/mobile` instead. The app reads
`EXPO_PUBLIC_SUPABASE_*` from the root `.env` (via `app.config.ts`).

- **Main map** (Map tab): the map is the interface. It fills the screen at your location (Ipoh if
  location is denied), with the search bar floating on top and a locate button. A compact "Your
  area" card at the bottom shows the overall risk badge and a Haze / Flood / Illness tile each,
  worked out on the device with the engine's `assessPoint`. The tiles are also the layer
  switcher: tap one to show only that hazard's zones in its own colours, with its legend and a
  button to the full hazard map and forecast; tap it again to show every zone.
- **Maps**: every map is Leaflet in a WebView (`components/map/web-map.tsx`) with Humanitarian
  OpenStreetMap tiles (OSM France, no key). react-native-maps was dropped: in Expo Go on Android
  it uses Google Maps with Expo Go's key, and on some phones that map drew nothing at all. Screens
  pass zones, lines and markers as plain data; taps come back as ids. Leaflet loads from unpkg,
  so the map needs a connection (the risk cards still work offline from cache). For a public
  launch, move to a paid or self-hosted tile service.
- **Haze map**: grey, amber and purple palette under a haze tint. Fire-hotspot icons (🔥, 0.1°
  cells from the last 48 h), wind arrows, and animated drift particles that follow the wind near
  the centre of the map and stay still when the phone's reduce-motion setting is on. Time slider
  for Now / +12h / +24h / +48h / +72h, PM2.5 at your location as a Malaysian API-style band, and
  a "why" panel.
- **Flood map**: blue and teal palette. Rain stations coloured by JPS intensity, with a 1 h / 24 h
  toggle. River gauges coloured by Normal / Alert / Warning / Danger, with a trend arrow. Flood
  zones, a station detail sheet, and a link to the official JPS alerts page.
- **Illness map**: red and pink palette. District choropleth, filter chips per disease, and
  facility pins showing the number of reports (never patients). The district sheet has a 14-day
  sparkline per disease and the linked-hazard notes ("Flooding in Kerian → higher leptospirosis
  risk").
- **Zone detail sheet** (tap any zone): hazard, level, valid time, confidence, why, bilingual
  advice, sources and last updated.
- **EN / BM** via i18next. The language follows the device and can be switched in Settings.
  Every risk level is shown as colour + icon + text.
- **Offline**: every layer keeps its last copy in AsyncStorage and shows "Offline: showing saved
  data". Data older than 2 h gets a stale warning, and mock-backed data is labelled
  "Simulated data".
- **Onboarding** (3 swipes): what the app does; location and notification permissions, with an
  explanation that background location is only for alerts; language. No account is needed:
  the app signs in anonymously, and Settings → Delete my data removes everything.
- **Destination check**: Nominatim search (Malaysia only, debounced, cached) → risk at the
  destination now or at a chosen arrival time (+1h … +48h) → OSRM route from your location,
  coloured by risk, with "Along your route: flood risk near Kuala Kangsar (high)". Then
  **Save place** or **Notify me about this place**.
- **Places**: saved places with their current risk, a per-place alert switch, and remove.
- **Alerts**: your alert history (tap to open the map at that zone), active official JPS alerts,
  and admin announcements.
- **Settings**: language, hazards to notify, minimum level, quiet hours, saved-place alerts,
  background location, delete my data. Tap the version 5 times to reveal **Simulate my location
  at…** (Perak districts), for demos.

### Notifications

After every prediction run the worker runs `notify_affected_users` (`npm run notify` runs it on
its own):

1. `notify_candidates()` (PostGIS `ST_Intersects`) finds devices whose last location, or whose
   owner's saved places, are inside zones that are active or start within 24 h.
2. Rules (`worker/src/notify/decide.ts`, unit-tested): the hazard must be switched on and at least
   the user's minimum level. One alert per device per hazard per run. No repeat of the same hazard
   and target within 6 h unless the level rises. Quiet hours (Malaysia time) hold everything except
   **severe**.
3. Delivery: **Expo push** in batches of 100 when the device has a push token. Dead tokens
   (`DeviceNotRegistered`) are removed. Otherwise the alert is **in-app**: the worker inserts the
   `notifications` row, and the app receives it over Supabase Realtime and shows a local
   notification. Every alert is logged in `notifications`.
4. Tapping an alert opens the hazard map centred on the zone (`/flood?lat=…&lon=…`).

**Push needs a development build.** Expo Go on Android can't receive remote push (SDK 53+), and
push tokens need an EAS project ID. In Expo Go, alerts arrive in-app, which works for the demo
while the app is open or in the background. For real push and background location:

```bash
npx eas-cli@latest init
```

```bash
npx eas-cli@latest build --profile development --platform android
```

Background location (opt-in in Settings) also only runs in a development build. It stores only the
last known location, never a history.

`scripts/e2e-notify.ts` checks the whole pipeline against the real database. It attaches a
temporary device with a fake push token to the demo admin user inside a live zone, runs the job
twice (alert, then dedupe), checks that the dead token is cleared, and deletes the test rows.

## Hospital portal (`/hospital`)

Next.js 16 (App Router, Cache Components) with Supabase Auth via `@supabase/ssr`. Run it with
`npm run dev:web` and open http://localhost:3000/hospital.

- **Sign in / sign up** at `/login` (email + password). New staff accounts start with no facility.
- **Join request**: choose a verified facility, or propose a new one. An admin approves it
  (Phase 8). Until then the dashboard shows "pending".
- **Dashboard**: your facility, whether today's report is in, reports flagged for review, and a
  14-day bar chart (hover tooltips, screen-reader table, palette checked with the dataviz
  validator for light and dark).
- **Report cases**: grid with one row per disease ("Add another disease"). Validation: whole
  numbers ≥ 0, no future dates or dates more than 60 days back, no duplicate disease+date. Notes
  with IC or phone numbers are refused, both in the app and by a database CHECK. **Spike
  warning**: if a count is more than 5× the facility's usual daily count (28-day average; the
  multiplier is the admin setting `disease.spike_warning_multiplier`), the form lists the spikes
  and asks you to confirm. Confirmed spikes are flagged for an admin to verify.
- **CSV upload**: download the template (`/hospital/template.csv`), upload, preview with per-row
  errors, submit through the same validation and spike check.
- **History**: last 60 days with status (submitted / verified / rejected, flagged, change
  requested). **Edit** within 48 h of submitting. After that, **Request change** with a reason
  goes to `case_report_edits` for admin approval.
- **District map**: view-only MapLibre map (OpenStreetMap tiles) of illness risk by district,
  with a disease filter and per-district details.
- A permanent notice on every page: _Enter aggregated counts only. Do not enter patient names, IC
  numbers, or any personal data._

Security: `proxy.ts` refreshes the session and sends signed-out visitors to `/login`. That is an
optimistic check only. Every page and Server Action re-checks the user and role through the data
access layer (`src/lib/auth.ts`) and re-validates input. RLS then limits staff to their own
verified facility, and the database rate-limits submissions. Pages read the session inside
`<Suspense>`, so each route is a static shell with the signed-in content streamed in.

Tests: `npm run test -w @jagasekitar/web` (validation, CSV, spike and edit-window rules).
E2E smoke test of the form (Playwright, signs in with `DEMO_STAFF_*` from `.env` and submits a
zero-count row tagged "e2e smoke test"):

```bash
npx playwright install chromium
```

```bash
npm run e2e -w @jagasekitar/web
```

## Demo mode (`/admin/demo`)

Live hazards may not be happening on pitch day, so the admin panel can replay one of three
scenarios defined in [`supabase/seed/demo/`](supabase/seed/demo):

| Scenario                          | What happens                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Riau fires → Perak haze           | ~300 hotspots in Riau/Jambi; wind turns south-south-westerly 6 h in; smoke reaches Manjung and Kinta in 24–48 h                   |
| Monsoon flash flood               | Real JPS stations in Kerian and Kuala Kangsar: rain past 60 mm/3 h, rivers Normal → Alert → Warning → Danger in ~1 h of demo time |
| Post-flood leptospirosis + dengue | Clinic reports in Kerian and Kinta climb to many times the baseline; flood linkage shown                                          |

How it runs: keep `npm run worker:dev` running. While demo mode is on, the worker pauses live
adapters and every 30 s advances the scenario on its own clock (real time × speed, plus
fast-forward), re-runs the engines and sends alerts. The app shows "Demo scenario running". To put
a phone in the action: Settings → tap the version 5 times → **Simulate my location at…**.
**Stop demo** deletes every demo-tagged row (`source = 'demo'`, `raw.demo`, `notes = 'demo
scenario'`) and asks the worker to refresh live data.

Rehearse without pinging phones (runs every scenario at key moments, prints the zones, cleans up):

```bash
npm run demo:check -w @jagasekitar/worker
```

The full 3-minute script is in [PITCH_NOTES.md](PITCH_NOTES.md#3-minute-demo-script).

## Run

| Command               | What                                           |
| --------------------- | ---------------------------------------------- |
| `npm run dev:web`     | Portal at http://localhost:3000                |
| `npm run dev:mobile`  | Expo dev server; scan the QR code with Expo Go |
| `npm run worker:once` | Run all data jobs once, then predictions       |
| `npm run worker:dev`  | Worker in watch mode                           |
| `npm run predict`     | Run the haze, flood and disease engines only   |
| `npm run notify`      | Run the notification job only                  |
| `npm test`            | Unit tests (all workspaces)                    |
| `npm run typecheck`   | TypeScript strict checks (all workspaces)      |
| `npm run format`      | Prettier                                       |

## Environment variables

See [`.env.example`](.env.example). Never commit `.env`. `SUPABASE_SERVICE_ROLE_KEY` is for the
worker and server-side code only.
