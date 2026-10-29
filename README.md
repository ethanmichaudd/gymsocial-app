# GymSocial

A personal training log — workouts, streaks, progress and gyms. One small
web app that installs on your phone like a native app.

```
  index.html ──► src/main.js ──► src/app.js   the whole app
                      │               │
                      │               └─ src/store.js   where data is saved
                      └─ src/pwa.js + public/sw.js      offline + installable
```

No framework. The app is plain JavaScript; Vite only bundles it and Capacitor
only wraps it.

---

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. The terminal also prints a `192.168.x.x` address —
open that on your phone (same wifi) to try it on the device you'll actually use.

---

## Step 1 — put it on your phone (10 minutes, free)

1. Push this folder to a GitHub repo named `gymsocial`.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Push to `main`. The included workflow builds and deploys automatically.
4. Open `https://<you>.github.io/gymsocial/` on your phone →
   **Share → Add to Home Screen**.

You get an icon, a fullscreen app with no browser chrome, and it opens offline.

> **Data lives on that device.** Export a backup from Settings now and then.
> Step 2 fixes this properly.

---

## Step 2 — accounts and sync (Supabase, free)

Needed before anyone can see anyone else's workouts. GitHub Pages only serves
files; it can't store data.

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste `supabase/schema.sql` → Run. That creates the tables
   and the row-level security policies.
3. **Settings → API** → copy the Project URL and anon key.
4. `cp .env.example .env` and fill both in.
5. Add the same two values as repo secrets so the deployed build gets them.

Then the only file that changes is `src/store.js`: `loadState` / `saveState`
start reading and writing your account's rows instead of `localStorage`.
Nothing else in the app knows where the data comes from — that's why it's the
only thing that has to change.

**Why RLS matters:** the anon key is public by design (it ships in the page).
What stops someone reading another person's private log is the database
policies in `schema.sql`, not anything in the UI.

---

## Step 3 — the feed

With accounts in place, bring back the social layer. The schema already has it:

| Table | Meaning |
|---|---|
| `follows` | one-way — whose sessions appear in your feed |
| `connections` | mutual, accepted — what unlocks a **private** account |
| `connection_requests` | pending asks |

They're deliberately separate: following is a subscription, connecting is
permission. A private account's workouts stay hidden until you're connected,
even if you follow them.

---

## Making it a real installable app (Capacitor)

The PWA above is enough for you and your friends. Do this when you want an
App Store / Play Store build.

```bash
npx cap init          # already configured in capacitor.config.json
npx cap add ios       # needs macOS + Xcode
npx cap add android   # needs Android Studio

npm run ios           # build + sync + open Xcode
npm run android
```

Same code, native shell. Storage becomes real app storage, so the OS stops
evicting it the way it can with browser data.

---

## Project layout

```
index.html                 markup + fonts + PWA tags
src/main.js                entry: styles, service worker, app
src/app.js                 the application (one file, no framework)
src/store.js               persistence — the seam for Supabase
src/pwa.js                 service worker registration
src/style.css              all styling
public/manifest.webmanifest, icon-*.png, sw.js
supabase/schema.sql        tables + row-level security
.github/workflows/deploy.yml
```

## Notes

- `BASE` is set by the deploy workflow to `/<repo>/` because project Pages
  sites aren't served from the root. Local dev and Capacitor use `/`.
- Bump `CACHE` in `public/sw.js` when you ship a change you want installed
  phones to pick up immediately.
