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
| 3     | Data adapters + worker (FIRMS, Open-Meteo, Infobanjir)     | ⏳      |
| 4     | Prediction engines + tests                                 | ⏳      |
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

## Run

| Command               | What                                           |
| --------------------- | ---------------------------------------------- |
| `npm run dev:web`     | Portal at http://localhost:3000                |
| `npm run dev:mobile`  | Expo dev server; scan the QR code with Expo Go |
| `npm run worker:once` | Run all data jobs once                         |
| `npm run worker:dev`  | Worker in watch mode                           |
| `npm test`            | Unit tests (all workspaces)                    |
| `npm run typecheck`   | TypeScript strict checks (all workspaces)      |
| `npm run format`      | Prettier                                       |

## Environment variables

See [`.env.example`](.env.example). Never commit `.env`. `SUPABASE_SERVICE_ROLE_KEY` is for the
worker and server-side code only.
