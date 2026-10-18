# JagaSekitar: pitch notes

**One line:** a phone app that warns Malaysians about haze, floods and disease outbreaks _where they are and where
they're going_, explains why, and tells them what to do, in English and Bahasa Melayu.

## The problem

- Transboundary haze from Sumatra and Kalimantan returns most dry seasons, but people learn about it when the API
  reading is already unhealthy.
- Flash floods in Perak build within hours. JPS publishes excellent rain and river data, but it's tables per station,
  not "is my road safe?".
- After floods, leptospirosis and dengue rise. Clinics see it first; the public rarely hears about it in time.

## What we built

| For       | Feature                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Public    | "Your area" risk card, three hazard maps with their own look, zone sheet with _why_ and _what to do_, EN/BM                     |
| Public    | Destination check: risk at arrival time + route coloured by risk ("flood risk near Kuala Kangsar")                              |
| Public    | Alerts for current location and saved places (Home, Kampung): dedupe, quiet hours, severe always gets through                   |
| Hospitals | Daily aggregate case entry, CSV upload, spike warnings, 48 h edits, district map; no patient data, enforced in app and database |
| Admins    | Data-source health, thresholds for every engine, station pins, approvals, moderation, district broadcast, audit log, demo mode  |

**Engines** (all thresholds editable by admins):

- **Haze:** clusters live NASA FIRMS hotspots, runs wind trajectories (850 hPa + 10 m from Open-Meteo), spreads and
  decays smoke on a 5 km grid, forecasts now → +72 h; Open-Meteo PM2.5 adjusts confidence.
- **Flood:** JPS rain (1/3/72 h) and river status (Normal/Alert/Warning/Danger) plus the rain forecast, scored by the
  JPS bands; official JPS alerts are always at least _high_. MetMalaysia rain warnings cover their districts, and the
  GloFAS river-flow forecast flags rivers heading above their 2/5/20-year flood flow days ahead.
- **Disease:** 7-day count vs. the 28-day baseline and cases per 100k per district; flooding raises water/vector-borne
  diseases and haze raises respiratory ones, and the app says so.

## 3-minute demo script

1. **(0:00) Phone, main map.** "This is Ipoh right now: real JPS rain and river data, real wind." Tap _Flood_.
2. **(0:30) Admin → Demo mode → "Monsoon flash flood".** Speed ×4. In the app, Settings → tap version ×5 → simulate
   **Kerian**. As the demo clock passes 15 → 30 → 60 min, the flood map turns Alert → severe and an alert arrives:
   "🌊 Flood risk SEVERE near Kerian: 66 mm rain in 3 hours … Sg. Kurau is rising". Tap it → map opens on the zone.
3. **(1:15) Destination check:** "Going to Kuala Kangsar this afternoon?" Route turns red near the river.
4. **(1:40) Switch to "Post-flood leptospirosis + dengue".** Illness map: Kerian severe, "Flooding in Kerian → higher
   leptospirosis risk". Show the hospital portal: aggregate counts, spike warning.
5. **(2:15) Switch to "Riau fires → Perak haze".** Haze map: fires over Sumatra, wind turning; slide the time slider
   Now → +24 h → +48 h and watch the smoke cross the Strait to Manjung and Kinta. PM2.5 band: Unhealthy.
6. **(2:45) Admin → Broadcast:** pick Kerian, send "Evacuation centre open at SK Bagan Serai". Phone receives it.
   **Stop demo** → live data returns.

Rehearse without phones: `npm run demo:check -w @jagasekitar/worker`.

## Honest limitations

- Predictions are **indicative**. The haze model is a simplified puff model (no terrain, vertical mixing or
  chemistry); flood zones are rule-based buffers, not hydraulic models; disease signals depend on how many
  facilities report.
- **Measured air quality is sample data** until a free WAQI token is added. Fire data is live from NASA FIRMS.
- GloFAS cells are ~5 km, so a forecast may describe a neighbouring river; it never raises risk above high on its own.
- **JPS has no public API**: we parse its web pages, which can change (the parsers fail loudly and fall back to cache,
  then mock). Station coordinates are approximate for some stations until an admin pins them.
- **Remote push needs a development build** (EAS). In Expo Go, alerts arrive in-app over Realtime. Background
  location also needs a development build.
- Perak only (districts, facilities, rain-forecast grid); other states need their district data and facilities.
- Hospital reports and demo scenarios are synthetic; no real patient or facility data was used.

## Built / mocked / not built

| Area                          | Status                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Open-Meteo wind, rain, PM2.5  | ✅ Live                                                                                  |
| JPS rainfall, rivers, alerts  | ✅ Live (scraped), with saved-fixture parser tests                                       |
| NASA FIRMS                    | ✅ Live (~12,000 hotspots over 2 days)                                                   |
| MetMalaysia warnings          | ✅ Live (data.gov.my), district-wide flood zones                                         |
| GloFAS river forecasts        | ✅ Live, against each river's 2/5/20-year return periods                                 |
| Measured air quality (WAQI)   | ◐ Adapter built and tested; **sample data** until `WAQI_TOKEN` is set                    |
| Haze / flood / disease        | ✅ Engines, tests, live predictions every worker tick                                    |
| User app                      | ✅ All screens, EN/BM, offline cache, error screen                                       |
| Notifications                 | ✅ In-app over Realtime (Expo Go); ◐ remote push needs a dev build + EAS project ID      |
| Hospital portal               | ✅ Built; ◐ Playwright smoke test written, run it with `npm run e2e -w @jagasekitar/web` |
| Admin panel                   | ✅ Built                                                                                 |
| Demo mode                     | ✅ Three scenarios, fast-forward, simulate location, clean stop                          |
| APIMS (official API)          | ✗ Not built (no public API); Open-Meteo PM2.5 used instead                               |
| Polygon drawing for broadcast | ✗ District selection instead                                                             |
