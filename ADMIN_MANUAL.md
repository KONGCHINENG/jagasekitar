# JagaSekitar — Admin user manual

For state disaster officials and system administrators who run JagaSekitar from the web portal.

- **Portal:** https://jagasekitar-web.vercel.app/admin (or http://localhost:3000/admin on the laptop)
- **Who can use it:** accounts with the **Admin** role. Hospital staff use `/hospital`; the public
  uses the phone app.

---

## 1. What the system does (in one minute)

1. A **data worker** collects data every few minutes: NASA fires, JPS rain/river levels and alerts,
   MetMalaysia warnings, Open-Meteo weather, GloFAS river forecasts, DOE air quality (WAQI), and
   hospital case reports.
2. Three **rule-based engines** turn that into risk zones for **haze, flood and illness**, each with
   a level (low → moderate → high → severe) and a reason ("why").
3. People with the app get **alerts** when their location or a saved place enters a zone (no
   repeats within 6 h; quiet hours respected except for severe).
4. **You** keep the system healthy and accurate, approve hospital staff, review reports, tune
   thresholds, and send official broadcasts.

> Predictions are estimates. Official advice from JPS, MetMalaysia, NADMA and KKM always comes first.

---

## 2. Signing in

1. Open the portal → **Sign in** → your work email and password.
2. You land on **Overview**. The left menu has every page; **Sign out** is top right.
3. Forgot your password? Ask another admin, or reset it in the Supabase dashboard.

Every change you make is recorded in the **Audit log** with your name and the time.

---

## 3. Daily routine (5 minutes)

| When               | Do                                                                           | Page                       |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------- |
| Morning            | Read the **AI briefing** (written automatically at 7 am)                     | AI briefing                |
| Morning            | Check every data source is **● Live**                                        | Overview                   |
| Morning            | Clear anything in **Needs your attention** (staff requests, flagged reports) | Overview                   |
| During the day     | When risk is **high/severe** somewhere, decide whether to send a broadcast   | Overview → Broadcast alert |
| Weekly             | Look through the **Audit log** for anything unexpected                       | Audit log                  |
| After a real flood | Add it as a **past flood event**, then re-run calibration                    | Calibration                |

---

## 4. Pages

### 4.1 Overview

Your dashboard.

- **Active zones** — how many haze, flood and illness zones exist now, by level.
- **Needs your attention** — pending staff requests and flagged case reports.
- **Recent prediction runs** — when the engines last ran and whether they succeeded.
- **Data-source health** — one row per source:

  | Status                | Meaning                                                            | What to do                                                                  |
  | --------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
  | **● Live**            | Updated recently with real data                                    | Nothing                                                                     |
  | **◐ Sample data**     | Running on example data (e.g. a missing key)                       | Check Data sources                                                          |
  | **◷ Stale (2 h ago)** | No update for 3 refresh periods                                    | Usually the worker isn't running (see §7)                                   |
  | **✕ Failing**         | The last attempt failed after the last success; the error is shown | Data sources → ↻ Refresh now; if it keeps failing, the provider may be down |
  | **○ Disabled**        | Paused by an admin                                                 | Data sources → Enable                                                       |

  If every source is stale, a note says **"Is the worker running?"**.

### 4.2 Data sources

One card per source (FIRMS, Open-Meteo, JPS rain / river / alerts, MetMalaysia, GloFAS, WAQI).

- **Pause / Enable** — stop or restart a source.
- **↻ Refresh now** — ask the worker to fetch it on its next tick (≈30 s with the laptop worker).
- **Refresh every (minutes)** → **Save interval** — how often it runs.
- **Last success / Last error / Records last run** — an error older than the last success is shown
  in grey as _Resolved_.

### 4.3 Thresholds

Every number the engines use, grouped by **haze, flood, disease, notifications, ai**, … Each card
has **Save** and **Reset** (Reset only undoes unsaved edits).

Key settings:

- **flood** — rain thresholds, zone radius per level, minimum level for official JPS alerts, and the
  GloFAS rules ("level when forecast flow reaches the 2 / 5 / 20-year flood flow").
- **haze** — smoke model settings and PM2.5 band limits.
- **disease** — outbreak minimum cases and ratio, which diseases floods/haze raise, hospital spike
  warning, edit window (48 h).
- **notifications** — repeat-alert window, quiet-hours bypass level.
- **ai** — morning briefing on/off, its hour (Malaysia time), briefings per day.

After saving, use **↻ Re-run predictions** (on the preview map at the right) to see the effect.
Change one thing at a time and note why in your team log; all changes are in the Audit log.

### 4.4 Calibration (flood)

Tunes the flood rain thresholds against **real past floods** instead of guesses.

1. **Past flood events** — each row: district, dates, what happened, **source** link, status.
   - Open the source, check district and dates → **Verify** (or **Delete** if wrong).
   - **Add a past flood** at the bottom (district, first and last day, source link, what happened).
     Events you add are saved as verified.
   - Only **verified** events are used.
2. **Run** the calibration (laptop, Command Prompt):
   ```bat
   cd /d C:\Users\User\Desktop\jagasekitar
   npm run calibrate
   ```
3. **Latest run** — current vs suggested thresholds:

   | Column       | Meaning                                           | Better is   |
   | ------------ | ------------------------------------------------- | ----------- |
   | Caught       | Floods warned from 2 days before until they ended | Higher      |
   | False alarms | Warnings with no flood in that district           | Lower       |
   | Skill (CSI)  | Caught ÷ (caught + missed + false alarms)         | Closer to 1 |
   | Warning      | Days of warning before the flood began            | Higher      |

4. **Apply suggested thresholds** — writes them into Thresholds → flood (audited) and re-runs
   predictions. Undo by setting the old values back in Thresholds.

Read the caveats under the table: the replay uses gridded rain (weaker than gauges) and assumes a
perfect forecast. Rain alone catches only some floods; river gauges, JPS alerts and GloFAS do the
rest.

### 4.5 AI briefing

An AI agent reads the current zones, official alerts, hospital totals, data health and recent
broadcasts, then drafts a **summary in English and Bahasa Melayu** and **suggested broadcasts**.
**It never sends anything.**

1. **✨ Generate briefing now** → status shows _Waiting for the worker…_ then _Writing…_ (1–6
   minutes). The page refreshes itself.
2. Read the summary. Check it against the maps — AI can make mistakes.
3. Each suggestion shows level, districts, EN/BM text and **"Based on: …"** (the data behind it).
4. **Review & send as broadcast →** opens the Broadcast page pre-filled (§4.6). Edit, then send.
5. **History** lists every briefing (manual or scheduled) with done/failed and the reason.

Needs the worker running with an AI key (`NVIDIA_API_KEY`). Only district-level data is sent to
the AI service — never user locations or personal data.

### 4.6 Broadcast alert

Send an official message to every phone whose last location is in chosen districts.

1. **Choose the area** — click districts on the map (selected ones are coloured).
2. **Level** — low / moderate / high / severe (sets the colour and priority).
3. **Title and message** in English (required) and Bahasa Melayu (recommended).
4. The **Phone preview** shows what people will see, including **📍 Area: …**.
5. **Review & send** → shows how many devices will receive it (by push / in-app) → confirm.

Good practice: say **what**, **where**, **what to do**, and **where to get official updates**.
Example: _"Pusat pemindahan sementara dibuka di SK Bagan Serai. Ikut arahan pihak berkuasa."_
Severe messages ignore quiet hours. A broadcast **cannot be recalled** — check before sending.
Recent broadcasts are listed below the form.

### 4.7 Stations

JPS rain and river stations on a map. JPS doesn't publish exact coordinates, so some pins are
approximate (_Geocoded_ / _Seed placeholder_).

- **Drag a pin** to the correct place; it becomes **Set by admin** and the worker never overwrites it.
- **Deactivate** a station that is broken or has moved (**Activate** brings it back).

### 4.8 Facilities & staff

- **Pending requests** — hospital/clinic staff asking to join a facility (or proposing a new one).
  **Approve** gives them the Hospital staff role; approving a proposed facility creates it as
  verified. **Reject** asks for confirmation.
- **Facilities** — **Verify / Unverify** a facility. Only verified facilities count on the illness
  map.

### 4.9 Case reports

Daily aggregate case counts from hospitals (no patient data).

- **Flagged as unusual spikes** — much higher than usual for that facility.
  **Verify** if correct; **Reject** if wrong (excluded from the illness map; asks to confirm).
- **Change requests** — edits after the 48-hour window; **Apply** or **Reject**.
- **Latest submissions** — the most recent reports.

Changes reach the maps within ~30 s (the worker re-runs predictions when a report changes).

### 4.10 Users

- **Role** — User / Hospital staff / Admin. Hospital staff need a **Facility**.
- **Deactivate / Activate** — blocks or restores portal access.
- App users are anonymous unless they signed up.

Keep admins to the minimum needed. Your own row is marked **You**, and its role and active
switches are locked, so you can't lock yourself out.

### 4.11 Demo mode

Replays prepared scenarios instead of live data, so a presentation works in any weather.

1. Choose a **Scenario** (Monsoon flash flood, Post-flood leptospirosis + dengue, Riau fires → Perak
   haze) and a **speed** → **Start demo mode**.
2. Fast-forward with **⏩ +30 min / +3 h / +12 h**.
3. **Stop** (asks "Switch back to live data?") — live data returns on the next worker tick.

While demo mode is on, **everyone's app shows the demo**. Use it only for presentations, and
stop it afterwards. Needs the laptop worker (it advances every 30 s).

### 4.12 Audit log

Every change to reports, facilities, users, settings, broadcasts, stations, calibration and AI
briefings: **When, who, Action, Entity, Change**. Use it to answer "who changed this and when?".

---

## 5. Emergency playbook (flood example)

1. **Overview** → flood zones at **high/severe**? Open the app's Flood map to see where and why.
2. **AI briefing** → **Generate** (or read the latest) for a quick bilingual summary.
3. Cross-check the official sources: JPS (publicinfobanjir.water.gov.my), MetMalaysia, NADMA.
4. **Broadcast alert** → affected districts → level → clear EN + BM message → **Review & send**.
5. After the event: add it to **Calibration → Add a past flood** (with a news/NADMA source) and run
   `npm run calibrate`.

---

## 6. Risk levels and colours

| Level        | Meaning for the public                                      |
| ------------ | ----------------------------------------------------------- |
| **Low**      | Be aware                                                    |
| **Moderate** | Take precautions; sensitive groups take care                |
| **High**     | Act: prepare to move, avoid exposure                        |
| **Severe**   | Follow official instructions now; alerts bypass quiet hours |

PM2.5 bands (µg/m³): Good ≤ 15 · Moderate ≤ 35 · Unhealthy for sensitive groups ≤ 55 ·
Very unhealthy ≤ 150 · Hazardous above. Measured readings at "unhealthy for sensitive groups" or
worse create a haze zone for the next 3 hours.

---

## 7. Troubleshooting

| Problem                                     | Likely cause                                               | Fix                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| All sources **◷ Stale**                     | Worker not running                                         | Laptop: `npm run worker:dev` (keep the window open). Online: GitHub → Actions → Data worker → Run workflow |
| One source **✕ Failing**                    | Provider down or key expired                               | Data sources → ↻ Refresh now; check the error text; renew the key if it says unauthorised                  |
| AI briefing stays _Waiting for the worker…_ | No worker with the AI key running                          | Start the laptop worker, or add `NVIDIA_API_KEY` as a GitHub secret                                        |
| AI briefing **failed**                      | Free credits used up, model busy, or daily limit           | Read the error in History; check build.nvidia.com credits; Thresholds → ai → daily limit                   |
| Hospital report change not on the map       | Worker not running                                         | Start the worker; the map updates within ~30 s                                                             |
| "Something went wrong" page                 | Temporary database/connection issue                        | **Try again**; if it repeats, tell the developer with the _Reference_ number                               |
| Phone users not getting alerts              | Notifications off on the phone, or app closed without push | App → Settings → Delivery → **Send test notification**                                                     |

---

## 8. Good practice and rules

- **Check before you send.** Broadcasts go to real people and can't be recalled.
- **AI drafts, humans decide.** Never send an AI suggestion without reading it and checking the map.
- **No personal data** in broadcasts, report notes or flood-event descriptions.
- **One change at a time** in Thresholds; write down why.
- **Stop demo mode** after every presentation.
- **Protect your account:** don't share passwords; sign out on shared computers.
