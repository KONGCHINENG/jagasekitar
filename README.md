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
| 2     | Database: migrations, PostGIS, RLS, seed                   | ⏳      |
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
supabase           Supabase config, migrations, seed
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
