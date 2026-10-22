# JagaSekitar — How the system works

A hazard early-warning system for Perak, Malaysia: it collects open data about **haze, floods and
illness**, predicts where the risk is, and warns people on their phones. This document explains how
the parts work together, step by step, and what each kind of user does.

---

## 1. The parts

| Part                   | What it is                                                                                  | Who uses it                     | Where it runs                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| **Phone app**          | Maps, "Your area" risk, destination check, alerts, saved places (English and Bahasa Melayu) | The public                      | Android APK (Expo / EAS build)                                        |
| **Web portal**         | `/hospital` for hospital and clinic staff, `/admin` for state officials                     | Staff and admins                | Vercel (jagasekitar-web.vercel.app)                                   |
| **Database**           | All data, zones, reports, settings and the audit log, with row-level security               | Everything                      | Supabase (cloud)                                                      |
| **Data worker**        | Collects data, runs the prediction engines, sends alerts, writes AI briefings               | Runs by itself                  | Laptop (`npm run worker:dev`, every 30 s) and GitHub Actions (hourly) |
| **Prediction engines** | Transparent rules for haze, flood and disease                                               | Called by the worker            | Inside the worker                                                     |
| **AI briefing agent**  | Drafts a bilingual situation summary and broadcast suggestions                              | Admins                          | Inside the worker (NVIDIA-hosted model)                               |
| **Push service**       | Delivers notifications to phones                                                            | Called by the worker and portal | Expo push service → Firebase Cloud Messaging                          |

---

## 2. The main loop: from data to a warning

The worker repeats this loop every 30 seconds (laptop) or every hour (GitHub). Each step only does
work when something is due or has changed.

1. **Collect.** Each data source has its own refresh interval (Admin → Data sources). When one is due,
   the worker downloads it, checks it, and saves it. If a source fails, it falls back to its last
   saved copy, then to clearly labelled sample data, and the admin overview shows the problem.
2. **Store.** Readings go into the Supabase database (fires, weather grids, rain and river levels,
   official alerts, river forecasts, air-quality readings).
3. **Predict.** When new data arrived, a hospital report changed, or an admin asked, the three
   engines run and replace the risk zones: each zone has a hazard, a level (low → moderate → high →
   severe), the area it covers, how long it is valid, and a "why" in English and Malay.
4. **Decide who to alert.** For every phone, the worker compares its last location and saved places
   with the new zones, following each person's settings.
5. **Deliver.** Alerts go by push notification (even when the app is closed) and also appear inside
   the app over a live connection.
6. **Show.** The app's maps and the portal read the latest zones; the app refreshes every few minutes
   and has a refresh button on every map.

### Data sources and how often they update

| Source                        | What it gives                                                   | Default refresh   |
| ----------------------------- | --------------------------------------------------------------- | ----------------- |
| NASA FIRMS                    | Fire hotspots from satellites (Sumatra, Borneo, Peninsula)      | 3 h               |
| Open-Meteo                    | Wind (for smoke), PM2.5 forecast, rain forecast                 | 1 h               |
| JPS Infobanjir                | Rain at 47 stations, 28 river levels, official JPS alerts       | 15 min            |
| MetMalaysia (data.gov.my)     | Thunderstorm and continuous-rain warnings by district           | 30 min            |
| GloFAS (Open-Meteo Flood API) | River-flow forecast per gauge, against 2/5/20-year flood levels | 6 h               |
| WAQI                          | Measured PM2.5 at Department of Environment stations            | 1 h               |
| Hospital portal               | Daily case counts per facility and disease (no patient data)    | When staff submit |

### Alert rules (step 4)

- Only hazards the person turned on (Settings → Notify me about) and only at or above their
  **minimum level** (default moderate).
- **No repeat** of the same alert within **6 hours**, unless the level goes **up**.
- **Quiet hours** hold alerts back, except **severe** ones, which always go through.
- Admin broadcasts go to every phone whose last location is in the chosen districts.

---

## 3. The prediction engines (step 3)

All three are rules written in code, with every threshold editable in Admin → Thresholds. No black box:
every zone explains itself.

- **Haze.** Nearby fires are grouped; each group's smoke is carried along the forecast winds hour by
  hour, spreading and fading, on a 5 km grid. Zones are made for now, +12 h, +24 h, +48 h and +72 h.
  A **measured** DOE reading of "unhealthy for sensitive groups" or worse adds a zone around that
  station for the next 3 hours.
- **Flood.** A river at JPS Danger level means severe; heavy rain in 3 hours with a rising river
  nearby means severe; JPS alerts mean at least high; a MetMalaysia warning covers its whole district;
  a GloFAS forecast above a river's 2/5/20-year flood flow raises risk days ahead. Rain thresholds are
  tuned against real past floods (§5.4).
- **Disease.** This week's hospital cases compared with the usual weekly rate over the previous 4
  weeks; at least 5 cases and twice the usual rate means a possible outbreak. Flooding raises
  water-borne diseases and haze raises breathing illnesses by one level.

---

## 4. What each user does

### 4.1 Member of the public (phone app)

1. Install the app and go through the short onboarding (language, location and notification
   permission).
2. **Map tab:** see risk zones around you and the "Your area" card (haze, flood, illness). Tap a
   hazard tile to show only its zones; tap a zone for the reason and what to do.
3. **Where are you going?** Search a place: see the risk at arrival time and along the route.
4. **Places:** save home, work or kampung to get alerts for them too.
5. **Alerts tab:** your alerts, official JPS and MetMalaysia alerts, and announcements from officials.
6. **Settings:** language, which hazards to show, which alerts to get, minimum level, quiet hours,
   background location, **Send test notification**, and delete my data.

### 4.2 Hospital or clinic staff (portal `/hospital`)

1. **New staff account** on the sign-in page, then ask to join a facility (or propose one).
2. An admin approves the request (Admin → Facilities & staff).
3. **Report** daily case counts per disease. Totals far above usual (5× by default) show a **spike
   warning** first, so typing mistakes are caught.
4. Or **Upload** a CSV from the template.
5. **History:** edit reports within 48 hours; later changes become a request for an admin to apply.
6. Within about 30 seconds the illness map and alerts reflect the new numbers.

### 4.3 Admin (portal `/admin`)

Keeps the system healthy and accurate, approves staff, reviews reports, tunes thresholds, and sends
official broadcasts. See the **Admin manual** for every page; the daily routine is:

1. Read the AI briefing (written each morning).
2. Check every data source is Live.
3. Clear "Needs your attention" (staff requests, flagged reports).
4. When risk is high or severe, decide whether to broadcast.

---

## 5. Special workflows

### 5.1 A hospital report becomes an illness zone

1. Staff submit or correct a report in the portal.
2. The worker notices a report changed since the last disease prediction and re-runs the engines on
   its next tick (about 30 seconds with the laptop worker).
3. The district's illness zone updates; people in that district are alerted if the level reached
   their minimum.
4. If the report looked like a spike, it waits in Admin → Case reports for **Verify** or **Reject**
   (rejected reports are left out of the numbers).

### 5.2 An official broadcast

1. Admin → Broadcast alert: choose districts on the map, level, title and message (English and Malay).
2. **Review & send** shows how many devices will receive it.
3. On confirm, phones in those districts get a push notification starting with **📍 Area: …**, and
   the message appears under Alerts → Announcements. It is recorded in the audit log and cannot be
   recalled.

### 5.3 The AI briefing

1. An admin clicks **Generate briefing now** (or the morning briefing is queued automatically).
2. The worker sends the request to the AI model with six **read-only** tools: districts, active
   zones, official alerts, disease totals per district, data-source health, and recent broadcasts.
3. The model calls the tools it needs. If it answers without checking a source, the worker fetches
   that data, shows it, and asks for a revised answer, so every claim is backed by data.
4. The answer is checked against a fixed format (summary in English and Malay, up to five
   suggestions with valid levels and real districts) and saved.
5. The admin reads it and may open a suggestion in the Broadcast page, pre-filled, to edit and send.
   **The AI never sends anything**, and only district-level data is sent to it, never personal data.

### 5.4 Calibration from past floods

1. Admins keep a list of **real past floods** (district, dates, news or NADMA source) and verify
   each one.
2. `npm run calibrate` replays 2014 to today: daily rain history for every district and river-flow
   history for every gauge.
3. For many combinations of the rain thresholds it counts how many floods would have been warned
   (from 2 days before), how many were missed, and how many warnings were false alarms.
4. Admin → Calibration shows current and suggested thresholds with their scores. An admin decides
   and clicks **Apply**, which updates the flood thresholds and is recorded in the audit log.

---

## 6. Where everything runs (operations)

| Piece                    | Service                                                    | Updated by                                                      |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Code                     | GitHub (private repository)                                | `git push`                                                      |
| Automatic checks         | GitHub Actions **CI**: typecheck, lint, all tests          | Every push                                                      |
| Web portal               | Vercel                                                     | Deploys automatically on every push that changes the portal     |
| Database changes         | Supabase                                                   | `npm run db:push` from the laptop                               |
| Data worker (hourly)     | GitHub Actions **Data worker**                             | Uses the latest code automatically                              |
| Data worker (live, 30 s) | Laptop: `npm run worker:dev`                               | Restart after changes                                           |
| Phone app                | EAS build → APK link                                       | `npx eas-cli@latest build --platform android --profile preview` |
| Push notifications       | Expo push service + Firebase (project jagasekitar-c848e)   | Set up once                                                     |
| AI model                 | NVIDIA (build.nvidia.com), `openai/gpt-oss-20b` by default | Key in `.env` / GitHub secret                                   |

Secrets (database service key, FIRMS, WAQI, NVIDIA) live only in the laptop's `.env` and in GitHub's
encrypted secrets, never in the code, the app or Vercel.

---

## 7. Data and privacy

- **Phones:** only each device's **last known location** is stored (no history), to send alerts.
  Users can delete everything from Settings.
- **Hospitals:** only daily **aggregate counts** per disease and facility; notes are checked so IC
  numbers and names are refused.
- **AI service:** receives zones, official alerts, district totals and data health only.
- **Every change** by staff and admins is in the audit log.
- Predictions are estimates. Official advice from JPS, MetMalaysia, NADMA and KKM always comes first.

---

## 8. Timing cheat-sheet

| Event                                           | Reaches the phones in about                                       |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| JPS river level or alert change                 | 15–16 minutes (source refresh + next tick)                        |
| Hospital report or correction                   | 30 seconds (laptop worker running)                                |
| Admin broadcast                                 | Seconds                                                           |
| Threshold change (after **Re-run predictions**) | 30 seconds                                                        |
| AI briefing                                     | 1–6 minutes to write; nothing reaches phones until an admin sends |
| Without the laptop worker                       | Up to 1 hour (GitHub hourly run)                                  |
