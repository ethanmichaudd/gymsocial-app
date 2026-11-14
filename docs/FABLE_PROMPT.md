# GymSocial — build brief

You're picking up **GymSocial**, my gym-workout logging app. The vision: *Strava for gyms*. The gym is a place, not just a tag, and friends seeing each other's workouts is the main reason people log. I want this to feel like a polished, professional app, not a side project. Work through the phases below in order, checking in with me at the end of each phase.

---

## 0. How to work with me (read first)

- **The project is on my Mac at `/Users/ethanmichaud/gymsocial`.** Edit those files in place. Always **re-read a file right before you change it**. Other sessions have edited this project, and rebuilding from an old copy has wiped out features before.
- **Don't commit or push.** I review and commit myself.
- **Keep replies short.** Give me the answer plus at most a sentence of explanation. I'm a visual learner, so use small ASCII diagrams or mockups when they help. Use American spelling.
- **Ask before large design decisions.** Give me 2–4 options with your recommendation first.
- **Verify everything you build:** load it in a browser at phone size (390×844), test signed-out *and* signed-in, check light and dark themes, and look for console errors. Tell me plainly what you could and couldn't test.

## 1. What the app is today

- **Stack:** Vite 7, plain JS (no framework).
  - `src/app.js` is one large closure, about 5,200 lines.
  - `src/store.js` handles the Supabase sync engine, auth, friends, reactions and push.
  - `src/style.css` uses CSS variables only, with light (MyFitnessPal-style) and dark themes.
  - `index.html`, `public/sw.js` (service worker), `src/pwa.js`.
- **Deployed:** as a PWA to GitHub Pages (repo `ethanmichaudd/gymsocial-app`) through `.github/workflows/deploy.yml`. The `BASE` env var is set for the Pages subpath. People install it with Add to Home Screen on iPhone.
- **Supabase:** project ref `kmhndltnnlhovykfffjg`.
  - Schema is in `supabase/schema.sql`, with numbered migrations (`002_friends.sql` … `006_cardio.sql`).
  - Edge Function for push is in `supabase/functions`.
  - RLS throughout, with helpers `can_view(uid)` and `is_connected(uid)`.
  - Friends live in `connections` and `connection_requests`.
  - `reactions` has one row per person per workout.
  - Workout photos live in the `workout-photos` storage bucket.
- **Login is username + password.** A username becomes a fake email, `<name>@users.gymsocial.app`. Never use `supabase.auth.updateUser({ email })`, because Supabase rejects that domain. Renames go through the SQL function `change_username()`.
- **Features that exist:**
  - Home: stat tiles, a calendar, and a day panel under it (your workout and friends' workouts, with reactions, or a "Log a workout" bar).
  - Log: a Lift | Cardio switch.
  - Lift: equipment rail, weight modes (per hand ×2 in totals), first set prefilled lighter from last time, "+ Add set" copies the set above, inline +2.5/+5/+10 chips under the weight box, supersets, notes, name parsing ("dumbbell bicep curls" → Bicep Curl + Dumbbell), reuse a past workout, draft autosave/restore, Cancel.
  - Cardio: activity rail (Run, Walk, Hike, Bike, Spin, Row, Elliptical, Stair Climber, plus custom), time, distance, average pace/speed/split, incline/level, heart rate, steps and notes, plus cardio finishers inside a lift.
  - Friends: a scrolling feed with reactions, Manage (search by username, requests), profile sheets, and share-profile links (`?add=<username>`).
  - Profile tab, Progress (chart per exercise), Settings (account, notifications, equipment, theme, streak mode, and a Data sheet), and Web Push notifications.
- **iPhone PWA gotchas we've already hit:**
  - `display:flex` beats the `hidden` attribute, so add `[hidden]{display:none}`.
  - Removing something on `focusin` or `blur` shifts the layout, and the tap misses its button.
  - `visualViewport` keyboard detection is unreliable in the standalone app.
  - Links open in Safari, not the Home Screen app.
  - Web Push only works from the Home Screen app.
  - The notification icon is always the app icon.
  - Inputs need a 16px font or iOS zooms in.
- **Database rules:**
  - New SQL goes in a new numbered file (`supabase/007_….sql`) that is safe to re-run. Tell me exactly what to paste into the SQL editor.
  - Client code must keep working on a database that hasn't run the migration yet. For example, `store.js` only sends cardio columns when a set uses them.
  - Local data changes are idempotent migrations that run on every open (see `migrateExerciseNames`, `migrateCardio`).
- **Releases:** bump `CACHE` in `public/sw.js` with every change (it's at `gymsocial-v58` now).

---

## Phase 1 — Inbox + custom reactions

**Inbox**

- A bell in the header (next to the menu button) with a red unread count.
- It opens an Inbox sheet:

```
┌ Inbox ─────────────────────────┐
│ REQUESTS                       │
│ (DP) Dev Patel @devp           │
│      [Accept] [Decline]        │
│ ACTIVITY                       │
│ (MJ) Maya 🔥 your Leg Day · 2h │
│ (DP) Dev  accepted your request│
└────────────────────────────────┘
```

- Activity covers reactions on my workouts, accepted requests, and (Phase 3) comments.
- Track unread with a "last seen" time stored in settings, so it syncs across devices.
- Reactions need a `created_at` column. Add it in a migration if it's missing.
- Tapping an item opens the workout or the person's profile.
- A shared `?add=` link should land the request here too.

**Custom reactions**

- Keep the 4 quick ones (💪🔥👏🙌) and add a **+** that lets you type any single emoji with the phone's emoji keyboard.
- Validate that it's exactly one grapheme (use `Intl.Segmenter` with a fallback).
- Still one reaction per person per workout.
- Bars show the quick four plus any other emoji that was used, with counts.
- Check that the `reactions.emoji` column and RLS allow any short string.

## Phase 2 — Gyms as places (the large update)

- **A Gyms tab or screen with a map.** Use Leaflet + OpenStreetMap tiles: free, no API key, an exact pinned version from cdnjs or npm.
  - Pins show gyms that people have logged at.
  - Search by name or city, plus "Near me" using browser geolocation, only when I tap it.
- **Coordinates:** add `lat`/`lng` to `gyms`.
  - Geocode when a gym is added or edited, using Nominatim (1 request per second, cache results, include contact info as its usage policy requires).
  - Backfill existing gyms, and let me drag a pin to fix a wrong location.
- **Gym page:**

```
┌ Planet Fitness – Boston, MA ─────┐
│ 123 Main St · [map preview]      │
│ FRIENDS WHO TRAIN HERE           │
│ (MJ)(DP)  Maya, Dev  · 2 today   │
│ POPULAR HERE (last 30 days)      │
│ 1 Bench Press      214 sets      │
│ 2 Lat Pulldown     160 sets      │
│ BUSIEST          ▁▃▆█▆▃▁ (by hour)│
│ [Check in here] [Set as my gym]  │
└──────────────────────────────────┘
```

- **Privacy:** friends are shown by name. Everyone else is only counted, never named.
  - Build a `security definer` SQL function, e.g. `gym_stats(gym_id)`, that returns only totals: top exercises, sessions by hour of day, number of people this month.
  - It must never return names or workouts of people you aren't friends with.
- **Gym search when logging** should search all known gyms, not just mine, so one gym doesn't get duplicated by different people. Suggest the closest match before allowing "+ Add gym".

## Phase 3 — Make it different (signature features)

Propose the order and a mockup for each before building. My suggestions:

1. **"At the gym now":** when someone starts a workout with a gym check-in, friends see a live "Maya is at Planet Fitness · 25m" on Home and on the gym page. It clears when they save or cancel, and expires after 3 hours. Opt-in, off by default.
2. **Train together:** tag friends in a workout. They get an inbox item to add it to their own log with one tap.
3. **Gym regulars and monthly crowns:** a leaderboard per gym among friends (sessions this month), with a crown for #1 and badges like "10 visits".
4. **Shareable workout card:** render a workout or PR as a branded image (canvas) for Instagram Stories or texting.
5. **Weekly recap:** a Sunday summary card of workouts, volume, PRs, streak, top gym and friends' highlights. Also send it as a push notification.
6. **Comments** on workouts, alongside reactions.

## Phase 4 — Professional polish (an audit of what's missing)

Fix these, and tell me anything else you find:

- **First-run onboarding:** create account → pick username → add your gym (from the map) → set a weekly goal → log your first workout.
- **A rest timer between sets:** auto-start on completing a set, a big countdown, a vibration or sound at the end, and default times per exercise. Every serious gym logger has one, and it's the biggest gap right now.
- **Exercise depth:**
  - Estimated 1RM, plate calculator, PR badges shown in the feed.
  - A muscle-group map of what you trained this week.
  - Saved routines/templates, separate from "reuse a workout".
- **Feel:**
  - Swipe down to close every sheet, and smooth sheet and tab transitions.
  - Pull to refresh on the feed and Home.
  - Skeleton loading states instead of blank areas.
  - A celebration on a PR, respecting `prefers-reduced-motion`.
  - One consistent icon set (no mix of emoji and SVG in the UI chrome).
- **Trust and account:**
  - Change password, delete account (and all data).
  - Private account toggle, block/report a user.
  - Clear sync and offline status with retry.
  - A global lb/kg preference.
- **Accessibility:** 44px tap targets, labels on icon buttons, contrast in both themes, visible focus, and screen reader names for charts.
- **Quality:**
  - Split `app.js` into modules (feed, log, cardio, gyms, inbox, profile, settings) without changing behavior.
  - Add an automated test suite (Playwright) covering the core flows, so future changes can't silently break things.

## Done means

For each phase:

- The features work signed-out and signed-in, on phone width, in both themes.
- Nothing that already works has broken.
- SQL migrations are written, and you've told me exactly what to run.
- `CACHE` in `public/sw.js` is bumped.
- You give me a short summary with a diagram of what changed.
