# Publishing JagaSekitar (step by step)

Do the parts **in this order**: GitHub first, because everything else builds from it.

| Part | What you get                                               | Account needed | Time   |
| ---- | ---------------------------------------------------------- | -------------- | ------ |
| A    | Code on GitHub (1.4)                                       | GitHub (free)  | 10 min |
| B    | Automatic checks on every push (1.5)                       | — (GitHub)     | 5 min  |
| C    | Portal online at `https://<name>.vercel.app` (1.1)         | Vercel (free)  | 20 min |
| D    | Worker running on a schedule without your laptop (1.3)     | — (GitHub)     | 15 min |
| E    | Installable Android app, no Expo Go or laptop needed (1.2) | Expo (free)    | 40 min |

Commands are for **Command Prompt** (`cmd`). Your `.env` file never leaves your laptop: it is in
`.gitignore`, so it is not uploaded to GitHub. Each service gets only the values it needs.

> Before going public, replace the secrets that were pasted into chat (demo passwords, FIRMS key,
> WAQI token), then use the **new** values below. See "Replace secrets" at the end.

---

## Part A — Put the code on GitHub (1.4)

1. Go to <https://github.com/signup> and create a free account (skip if you have one).
2. Top right **+** → **New repository**.
   - Repository name: `jagasekitar`
   - Visibility: **Private** (recommended; see Part D for the trade-off)
   - **Do not** tick "Add a README", ".gitignore" or "license" (the project already has them).
   - Click **Create repository**.
3. GitHub shows a page with a URL like `https://github.com/YOUR-NAME/jagasekitar.git`. Copy it.
4. In Command Prompt:

   ```bat
   cd /d C:\Users\User\Desktop\jagasekitar
   git status
   ```

   It should say `nothing to commit, working tree clean`. If not, tell Claude before continuing.

5. Connect and upload (replace `YOUR-NAME`):

   ```bat
   git remote add origin https://github.com/YOUR-NAME/jagasekitar.git
   git push -u origin main
   ```

   A browser window opens to sign in to GitHub the first time: approve it.

6. **Check:** refresh the GitHub page. You should see folders `apps`, `worker`, `supabase`, … and
   **no `.env` file** in the list. (`.env.example` is fine: it has no values.)

Later, after each change: `git push`.

---

## Part B — Automatic checks (CI) (1.5)

Nothing to set up: `.github/workflows/ci.yml` is already in the code. It runs typecheck, lint, all
unit tests and the database tests on every push. It needs no secrets.

1. On GitHub, open the **Actions** tab of the repo.
2. You should see a run called **CI** for your push. Wait ~5 minutes.
3. **Pass:** a green ✓. A red ✗: click it, open the failed step, and send Claude the red text.

The same green ✓ / red ✗ appears next to every future commit.

---

## Part C — Portal on Vercel (1.1)

### C1. Create the project

1. Go to <https://vercel.com/signup> → **Continue with GitHub** (free **Hobby** plan).
2. **Add New…** → **Project** → find `jagasekitar` → **Import**.
   (If it's not listed: **Adjust GitHub App Permissions** → allow the `jagasekitar` repo.)
3. On the "Configure Project" page:
   - **Root Directory** → **Edit** → choose `apps/web` → **Continue**.
   - **Framework Preset**: Next.js (detected automatically).
   - Leave Build and Install commands as they are.
4. Open **Environment Variables** and add these (values from your `.env`):

   | Name                            | Value                                     |
   | ------------------------------- | ----------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | same as in `.env`                         |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as in `.env`                         |
   | `EXPO_ACCESS_TOKEN`             | same as in `.env` (optional; blank is ok) |

   **Never** add `SUPABASE_SERVICE_ROLE_KEY` to Vercel: the portal doesn't need it.

5. Click **Deploy**. Wait 2–4 minutes.
6. **Pass:** "Congratulations" with a preview picture. Click **Continue to Dashboard** and copy the
   **Domain**, e.g. `https://jagasekitar.vercel.app` (yours may have extra letters).

### C2. Use Node 24

Project → **Settings** → **Build and Deployment** → **Node.js Version** → **24.x** → Save.
Then **Deployments** → the newest one → **⋯** → **Redeploy**.

### C3. Tell Supabase about the new address (so sign-in works)

1. <https://supabase.com/dashboard> → your project → **Authentication** → **URL Configuration**.
2. **Site URL**: your Vercel domain, e.g. `https://jagasekitar.vercel.app`.
3. **Redirect URLs** → **Add URL**, add both:
   - `https://jagasekitar.vercel.app/**` (your domain)
   - `http://localhost:3000/**` (keeps local testing working)
4. **Save**.

### C4. Test

1. Open `https://YOUR-DOMAIN/admin` → sign in with the admin account.
2. Overview loads; **Data sources** shows the sources (they are live only if a worker is running:
   your laptop's `npm run worker:dev`, or Part D).
3. Open `https://YOUR-DOMAIN/hospital` in a private window → sign in as staff → submit a test report.

If the build fails with "Cannot find module '@jagasekitar/shared'": Settings → Build and Deployment
→ **Install Command** → Override → `cd ../.. && npm ci` → Redeploy.

From now on every `git push` to `main` redeploys the portal automatically.

---

## Part D — Worker on a schedule (1.3)

`.github/workflows/worker.yml` runs the worker on GitHub's computers: it fetches the sources that
are due, re-runs predictions and sends alerts. It needs secrets, which GitHub stores encrypted.

### D1. Add the secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
Add each one (name exactly as shown, value from your `.env`):

| Secret name                 | From `.env`                              |
| --------------------------- | ---------------------------------------- |
| `SUPABASE_URL`              | `SUPABASE_URL`                           |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY`              |
| `FIRMS_MAP_KEY`             | `FIRMS_MAP_KEY`                          |
| `WAQI_TOKEN`                | `WAQI_TOKEN`                             |
| `NOMINATIM_USER_AGENT`      | `NOMINATIM_USER_AGENT`                   |
| `EXPO_ACCESS_TOKEN`         | `EXPO_ACCESS_TOKEN` (skip if empty)      |
| `NVIDIA_API_KEY`            | `NVIDIA_API_KEY` (AI briefing; optional) |

### D2. Run it once by hand

1. **Actions** tab → **Data worker** (left list) → **Run workflow** → **Run workflow**.
2. Wait ~3 minutes, open the run → **run** → expand "Run due sources…".
3. **Pass:** a green ✓, and in the log either
   - lines ending in `ok` and a table with `haze / flood / disease` `success`, or
   - `nothing due: every source refreshed within its interval` — normal when your laptop worker
     (`npm run worker:dev`) refreshed everything recently. To see a full run, stop the laptop
     worker, wait ~20 minutes, and run the workflow again.

   A red ✗ that mentions `SUPABASE_URL` or a missing key means a secret is missing or misnamed (D1).

4. The **"Node.js 20 is deprecated"** warning is gone once you've pushed the latest code (the
   workflows use the Node 24 versions of GitHub's actions).

### D3. How often it runs

- **Private repo** (default in the file): **hourly**. GitHub gives private repos 2,000 free minutes a
  month and each run takes ~2 minutes, so hourly fits.
- **Public repo**: minutes are free. Edit `.github/workflows/worker.yml` and change
  `cron: '7 * * * *'` to `cron: '*/15 * * * *'` (every 15 min), commit, push.
- GitHub may start scheduled runs a few minutes late, and skips them on repos with no activity for
  60 days.

To stop it: Actions → Data worker → **⋯** → **Disable workflow**.

---

## Part E — Android app (APK) with EAS (1.2)

### E1. Account and project

1. Create a free account at <https://expo.dev/signup>.
2. In Command Prompt:

   ```bat
   cd /d C:\Users\User\Desktop\jagasekitar\apps\mobile
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```

   `init` creates the project on expo.dev and adds its **projectId** to the app config.
   If it says it can't edit the config automatically (the project uses `app.config.ts`), it prints
   the projectId: send it to Claude, or add it to `apps/mobile/app.json` inside `"expo"`:

   ```json
   "extra": { "eas": { "projectId": "PASTE-IT-HERE" } }
   ```

3. Commit and push the change:

   ```bat
   cd /d C:\Users\User\Desktop\jagasekitar
   git add apps/mobile/app.json
   git commit -m "Add EAS project id"
   git push
   ```

### E2. Give the build the Supabase settings

The cloud build doesn't have your `.env`. On <https://expo.dev> → your project → **Environment
variables** → **Add variable**, for the **preview** environment, visibility **Plain text**:

| Name                            | Value                                       |
| ------------------------------- | ------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | `EXPO_PUBLIC_SUPABASE_URL` from `.env`      |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `.env` |

(These two are public by design. Never add the service role key here.)

### E3. Build the APK

```bat
cd /d C:\Users\User\Desktop\jagasekitar\apps\mobile
npx eas-cli@latest build --platform android --profile preview
```

- "Generate a new Android Keystore?" → **Yes** (Expo stores it for you).
- The build runs on Expo's servers: **10–30 minutes** on the free plan (there may be a queue).
- **Pass:** "Build finished" with a link and a QR code.

### E4. Install on a phone

1. Open the link (or scan the QR) on the Android phone → **Install**.
2. Allow "Install unknown apps" for your browser when asked.
3. Open **JagaSekitar**. It works anywhere with internet: **no Expo Go, no laptop, no QR code**.

Notes:

- **Background location** works in this build: Settings → "Background location".
- New version: run E3 again. (Small JS-only changes can later use `eas update` instead of a full build.)
- When asked "Install and run the Android build on an emulator?", answer **N** (that needs Android
  Studio; install on the phone instead).

### E5. Real push notifications (alerts when the app is closed)

Android delivers push through Firebase Cloud Messaging (free). Already set up for this project:

1. Firebase project `jagasekitar-c848e` with an Android app `com.jagasekitar.app`; its
   `apps/mobile/google-services.json` is committed (it's in every app build; not a secret) and
   `app.json` points to it (`android.googleServicesFile`).
2. The Firebase **service account key** (FCM V1) is uploaded to Expo with
   `npx eas-cli@latest credentials` → Android → preview → Google Service Account → FCM V1.
   That key is secret: it's stored only at Expo, never in the repo.

After a new build (E3) and install:

- App → **Settings → Delivery** says "Push notifications are on."
- **Send test notification** → a notification arrives within seconds ("Sent by push").
- Swipe the app closed, then Admin → **Broadcast** to your district → it arrives on the locked phone,
  and the portal reports "… by push".

If Settings still says in-app: open the app once with internet, check notifications are allowed
(Android Settings → Apps → JagaSekitar → Notifications), then reopen Settings.

---

## Replace secrets (do this before sharing links publicly)

1. **Demo accounts**: Supabase → Authentication → Users → each demo user → **Send password
   recovery** or set a new password. Update `DEMO_*` in your `.env`.
2. **FIRMS**: <https://firms.modaps.eosdis.nasa.gov/api/map_key/> → new key → `.env` and the GitHub
   secret `FIRMS_MAP_KEY`.
3. **WAQI**: <https://aqicn.org/data-platform/token/> → new token → `.env` and the GitHub secret
   `WAQI_TOKEN`.
4. Restart the laptop worker if it's running.

---

## Quick reference

| Task               | How                                                                                |
| ------------------ | ---------------------------------------------------------------------------------- |
| Update the portal  | `git push` (Vercel redeploys)                                                      |
| See check results  | GitHub → Actions → CI                                                              |
| Run the worker now | GitHub → Actions → Data worker → Run workflow                                      |
| New app build      | `npx eas-cli@latest build --platform android --profile preview` (in `apps\mobile`) |
| Database changes   | `npm run db:push` from your laptop (not automatic)                                 |
