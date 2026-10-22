# Testing JagaSekitar end to end (Windows Command Prompt)

Everything below is typed in **Command Prompt** (`cmd`), not PowerShell. In Command Prompt `npm` and `npx`
work directly; in PowerShell use `npm.cmd` / `npx.cmd` instead.

You need **three Command Prompt windows** open at the same time:

| Window | Runs                                   | Keep open?          |
| ------ | -------------------------------------- | ------------------- |
| A      | the data worker                        | Yes, the whole time |
| B      | the web portal (`/admin`, `/hospital`) | Yes, the whole time |
| C      | the phone app (Expo)                   | Yes, the whole time |

A fourth window is handy for the one-off checks in Part 1 and Part 6.

---

## Part 0 — One-time checks (each new session)

In any window:

```bat
cd /d C:\Users\User\Desktop\jagasekitar
nvm use 24.21.0
node -v
```

`node -v` must print **v24.21.0** (or another 22.13+). If `nvm use` says "access denied", open Command Prompt with
"Run as administrator" once and run it there.

Check `.env` exists and has values (it is never committed):

```bat
findstr /b "SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY FIRMS_MAP_KEY WAQI_TOKEN DEMO_ADMIN_EMAIL DEMO_STAFF_EMAIL" .env
```

Each line should have something after `=`. (Don't paste the output anywhere public.)

If you just pulled new code or someone changed `package.json`:

```bat
npm install
```

If there are new files in `supabase\migrations\` that the cloud database doesn't have yet:

```bat
npm run db:push
```

---

## Part 1 — Automated checks (5 minutes, optional but recommended)

```bat
cd /d C:\Users\User\Desktop\jagasekitar
npm test
npm run test:db
npm run typecheck
npm run lint
npm run lint -w @jagasekitar/mobile
```

**Pass:** every `Tests` line says `passed` (about 175 tests in total), typecheck prints no `error TS`, lint shows
`0 errors` (the mobile app has 3 harmless i18next warnings).

---

## Part 2 — Start everything

### Window A: data worker

```bat
cd /d C:\Users\User\Desktop\jagasekitar
nvm use 24.21.0
npm run worker:dev
```

**Pass (within ~1 minute):** a line for each source ending in `ok`, for example
`[firms] ok: 12700 records …`, `[metmalaysia] ok …`, `[glofas] ok …`, `[waqi] ok …`, then a table with
`haze / flood / disease` all `success`. Leave this window open: it refreshes every 30 s.

### Window B: web portal

```bat
cd /d C:\Users\User\Desktop\jagasekitar
nvm use 24.21.0
npm run dev:web
```

**Pass:** `Ready` and `http://localhost:3000`. If you see `EADDRINUSE :3000`, another portal is already running:
close the other window (or the Claude browser preview), then run it again.

### Window C: phone app

```bat
cd /d C:\Users\User\Desktop\jagasekitar\apps\mobile
nvm use 24.21.0
npx expo start --clear
```

(`npm run dev:mobile` from the repo root also starts it, but npm swallows extra flags such as `--clear`.)

On the phone (same Wi-Fi or hotspot as the laptop), open **Expo Go** (SDK 57) and scan the QR code.

- Different networks or the QR won't connect: stop with `Ctrl+C` and run `npx expo start --tunnel` in the same
  window (needs `npx expo login` first).
- Reload the app after code changes: press `r` in window C, or shake the phone → **Reload**.

---

## Part 3 — Admin portal (`http://localhost:3000/admin`)

Sign in with the **demo admin** account (email/password from `DEMO_ADMIN_*` in `.env`).

| #   | Page               | Do                                                             | Pass                                                           |
| --- | ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------- |
| 3.1 | Overview           | Look at "Data-source health"                                   | All 10 rows **● Live**, no red error text                      |
| 3.2 | Data sources       | Click **↻ Refresh now** on `metmalaysia`                       | "Last success" updates within ~1 min (watch window A)          |
| 3.3 | Thresholds         | In **flood**, change **rp2** to _low_ → **Save** → reload (F5) | Still _low_ after reload. Set it back to _moderate_ → **Save** |
| 3.4 | Stations           | Open one river gauge, move its pin, save                       | Its coordinates source shows **admin**                         |
| 3.5 | Facilities & staff | Approve a pending join request (if any)                        | Request disappears from the pending list                       |
| 3.6 | Case reports       | Find a report, hide or flag it                                 | Status changes                                                 |
| 3.7 | Broadcast          | District **Kerian**, short title/message → Send                | Appears in the app: **Alerts → Announcements** (app open)      |
| 3.8 | Users              | Open the list                                                  | Loads; don't deactivate your own admin                         |
| 3.9 | Audit log          | Open                                                           | Your actions from 3.2–3.7 are listed                           |

---

## Part 4 — Hospital portal (`http://localhost:3000/hospital`)

Sign out, then sign in with the **demo staff** account (`DEMO_STAFF_*` in `.env`).

| #   | Page      | Do                                           | Pass                                                      |
| --- | --------- | -------------------------------------------- | --------------------------------------------------------- |
| 4.1 | Dashboard | Open                                         | Your facility name, recent totals, no error overlay       |
| 4.2 | Report    | Enter today's **Dengue = 30** → submit       | **Spike warning** appears first; after confirming, saved  |
| 4.3 | Upload    | Download `template.csv`, fill 2 rows, upload | Success message for both rows (or each bad row explained) |
| 4.4 | History   | Edit one of today's reports                  | Saved; reports older than 48 h can't be edited            |
| 4.5 | Map       | Open                                         | District map loads (no "Worker failed to load")           |

Then on the phone: **Illness map** → your facility's district turns pink/red within ~1 minute (after window A runs
the next prediction). Tap the district: the dengue numbers and the "why" text appear.

---

## Part 5 — Phone app

| #    | Screen                              | Do                                                           | Pass                                                                                     |
| ---- | ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 5.1  | First launch                        | Swipe the 3 onboarding pages, allow location + notifications | Lands on the Map tab                                                                     |
| 5.2  | **Map** (home)                      | Look                                                         | Streets visible (not black), search bar on top, "Your area" card at bottom               |
| 5.3  | Map                                 | Tap **Flood** tile, then tap it again                        | Only flood zones + legend + "Flood map and forecast" button; second tap shows all        |
| 5.4  | Map                                 | Tap the round **target** button                              | Map returns to your location                                                             |
| 5.5  | Map                                 | Tap a coloured zone                                          | Sheet with **Why** and **What to do**                                                    |
| 5.6  | **Haze** map                        | Look at Now, then drag slider to +24 h                       | Numbered squares (measured PM2.5) at Now only; smoke zones change with time              |
| 5.7  | Haze map                            | Tap a numbered square                                        | Station name + "Measured PM2.5: … µg/m³" (dashed round ones say "Community sensor")      |
| 5.8  | **Flood** map                       | Switch Rain 1 h / 24 h, tap a river gauge                    | Rain dots change; gauge sheet shows level and trend                                      |
| 5.9  | **Illness** map                     | Tap a district, tap a hospital pin                           | District trend sheet; pin popup with report count                                        |
| 5.10 | **Search** ("Where are you going?") | Type `Kuala Kangsar`, pick a result                          | Route drawn and coloured by risk; "At your destination" and "Along your route" filled in |
| 5.11 | Destination                         | Tap the arrival chips (Now, in 1 h, …)                       | Chips readable; destination risk updates                                                 |
| 5.12 | Destination                         | **Save place**, then **Places** tab                          | Place listed; toggle alerts on/off                                                       |
| 5.13 | **Alerts** tab                      | Look                                                         | "Official alerts (JPS, MetMalaysia)" lists current alerts; announcements from 3.7        |
| 5.14 | **Settings**                        | Switch language to **Bahasa Melayu**                         | Every screen in BM (e.g. "Tidak sihat untuk golongan sensitif" on the haze legend)       |
| 5.15 | Settings                            | Turn on airplane mode, reopen a map                          | Cached data shows with an "offline" note; turn airplane mode off again                   |

Notes:

- "Push notifications unavailable in Expo Go" is expected. Alerts arrive **inside the app** while it is open.
- Background location and real push need a development build (EAS), not Expo Go.

---

## Part 7 — Portal smoke test (Playwright)

```bat
cd /d C:\Users\User\Desktop\jagasekitar
npm run e2e -w @jagasekitar/web
```

First time only, if it asks for browsers:

```bat
npx playwright install chromium
```

**Pass:** all tests `passed`. It signs in with the demo staff account from `.env` and reuses the portal in window B if it is running.

---

## Part 8 — Stop everything

In windows A, B and C press `Ctrl+C` (answer `Y` if asked "Terminate batch job?").

---

## If something goes wrong

| Symptom                                                       | Fix                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `'npm' is not recognized`                                     | Run `nvm use 24.21.0` in that window                             |
| `EADDRINUSE :3000`                                            | Another portal is running; close it, run `npm run dev:web` again |
| Admin overview shows **◷ Stale**                              | Window A (worker) isn't running: start it                        |
| Phone: "Project is incompatible with this version of Expo Go" | Expo Go must be SDK 57                                           |
| Phone: map is grey / blank                                    | No internet on the phone (maps load from the web)                |
| Phone: red error screen                                       | Screenshot it; press `r` in window C to reload                   |
| Portal: red Next.js overlay                                   | Screenshot it; check window B for the error text                 |
| `nvm use` → "exit status 1 / access denied"                   | Open Command Prompt as administrator once and run it             |
