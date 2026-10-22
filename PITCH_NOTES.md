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

| For       | Feature                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Public    | "Your area" risk card, three hazard maps with their own look, zone sheet with _why_ and _what to do_, EN/BM                      |
| Public    | Destination check: risk at arrival time + route coloured by risk ("flood risk near Kuala Kangsar")                               |
| Public    | Alerts for current location and saved places (Home, Kampung): dedupe, quiet hours, severe always gets through                    |
| Hospitals | Daily aggregate case entry, CSV upload, spike warnings, 48 h edits, district map; no patient data, enforced in app and database  |
| Admins    | Data-source health, thresholds for every engine, station pins, approvals, moderation, district broadcast, AI briefing, audit log |

**Engines** (all thresholds editable by admins):

- **Haze:** clusters live NASA FIRMS hotspots, runs wind trajectories (850 hPa + 10 m from Open-Meteo), spreads and
  decays smoke on a 5 km grid, forecasts now → +72 h; Open-Meteo PM2.5 adjusts confidence.
- **Flood:** JPS rain (1/3/72 h) and river status (Normal/Alert/Warning/Danger) plus the rain forecast, scored by the
  JPS bands; official JPS alerts are always at least _high_. MetMalaysia rain warnings cover their districts, and the
  GloFAS river-flow forecast flags rivers heading above their 2/5/20-year flood flow days ahead.
- **Disease:** 7-day count vs. the 28-day baseline and cases per 100k per district; flooding raises water/vector-borne
  diseases and haze raises respiratory ones, and the app says so.

## 3-minute demo script

1. **(0:00) Phone, main map.** "This is Perak right now: real JPS rain and river data, real wind, real fire hotspots."
   Tap _Flood_, then _Haze_, and tap a zone to show its "why".
2. **(0:40) Destination check:** "Going to Kuala Kangsar this afternoon?" Show the risk at arrival time and along the route.
3. **(1:10) Hospital portal:** submit today's counts for a clinic; show the spike warning. Within ~30 s the Illness map
   updates, with the flood or haze link explained.
4. **(1:50) Admin → AI briefing:** the bilingual situation summary and suggested broadcasts, each backed by data.
5. **(2:20) Admin → Broadcast:** pick a district, send a message. The phone receives it with **📍 Area: …**.

## AI agent (drafts only)

Admin → AI briefing: an AI agent (NVIDIA-hosted open model) reads the live zones, official alerts,
hospital totals and data health through read-only tools and drafts a briefing in English and
Bahasa Melayu with suggested broadcasts. An admin reviews and sends; the AI never sends anything,
gets no personal data, and must back every claim with the data it checked.

## Honest limitations

- Predictions are **indicative**. The haze model is a simplified puff model (no terrain, vertical mixing or
  chemistry); flood zones are rule-based buffers, not hydraulic models; disease signals depend on how many
  facilities report.
- Measured air quality is hourly; community sensors are shown but never used for zones. 35–55 µg/m³ is labelled
  "unhealthy for sensitive groups" (US-EPA wording); it still raises a moderate zone.
- GloFAS cells are ~5 km, so a forecast may describe a neighbouring river; it never raises risk above high on its own.
- **JPS has no public API**: we parse its web pages, which can change (the parsers fail loudly and fall back to cache,
  then mock). Station coordinates are approximate for some stations until an admin pins them.
- **Remote push needs a development build** (EAS). In Expo Go, alerts arrive in-app over Realtime. Background
  location also needs a development build.
- Perak only (districts, facilities, rain-forecast grid); other states need their district data and facilities.
- Test hospital reports are synthetic; no real patient data was used.

## Built / mocked / not built

| Area                          | Status                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Open-Meteo wind, rain, PM2.5  | ✅ Live                                                                                  |
| JPS rainfall, rivers, alerts  | ✅ Live (scraped), with saved-fixture parser tests                                       |
| NASA FIRMS                    | ✅ Live (~12,000 hotspots over 2 days)                                                   |
| MetMalaysia warnings          | ✅ Live (data.gov.my), district-wide flood zones                                         |
| GloFAS river forecasts        | ✅ Live, against each river's 2/5/20-year return periods                                 |
| Measured air quality (WAQI)   | ✅ Live: DOE monitors around Perak; unhealthy readings add zones for "now"               |
| Haze / flood / disease        | ✅ Engines, tests, live predictions every worker tick                                    |
| User app                      | ✅ All screens, EN/BM, offline cache, error screen                                       |
| Notifications                 | ✅ In-app over Realtime (Expo Go); ◐ remote push needs a dev build + EAS project ID      |
| Hospital portal               | ✅ Built; ◐ Playwright smoke test written, run it with `npm run e2e -w @jagasekitar/web` |
| Admin panel                   | ✅ Built                                                                                 |
| APIMS (official API)          | ✗ Not built (no public API); Open-Meteo PM2.5 used instead                               |
| Polygon drawing for broadcast | ✗ District selection instead                                                             |
