# GymSocial: notes for Claude

A gym training log with a social layer ("Strava for the gym"). Plain
JavaScript, no framework; Vite bundles it, it ships as a PWA on GitHub Pages,
and Supabase holds accounts and sync. The owner is not a professional
developer: explain choices in plain words and keep comments that way too.

## Commands

- `npm run dev`: the app on http://localhost:5173
- `npm test`: Playwright suite (own port 5199, stand-in Supabase). Run it before saying a change works.
- `npm run build`: production build (what GitHub Pages deploys)

## Layout

- `src/app.js` only starts things. Each screen is its own file: `core`, `log`,
  `cardio`, `feed`, `inbox`, `gyms`, `live`, `home`, `progress`, `profile`,
  `settings`. `store.js` is all storage and Supabase; `geo.js` is maps and
  address lookup.
- A screen file only *defines* things at load: functions and plain data.
  Anything that runs once at startup (wiring buttons, non-trivial starting
  values) goes in that file's `start...()` function, which `app.js` calls in
  a fixed order. Don't add top-level code that calls into another file.
- Imports are read-only. A variable another file needs to change has a
  setter next to it (`setState`, `setPendingAdd`, ...).
- The code is ES5-style on purpose (`var`, `function`); match it.

## Rules that have bitten before

- **Migrations are optional at runtime.** SQL lives in `supabase/NNN_*.sql`,
  safe to re-run, and the owner runs it by hand. The app must keep working
  on a database that hasn't run the newest one: `store.js` treats "no such
  table / column / function" as "not available yet", never as a failure.
- **Bump `CACHE` in `public/sw.js`** on any change, or phones keep the old app.
- **Privacy is enforced in SQL** (row level security and `can_view`), not by
  hiding things in the UI. Other people's data is only ever shown as counts.
- **OpenStreetMap's usage policies** are written up at the top of `src/geo.js`.
  The address lookup must stay queued, cached, never search-as-you-type.
- **iPhone Home Screen app:** inputs need 16px text or the page zooms;
  focusing an input only opens the keyboard from a real tap; don't remove or
  resize things on focus/blur (the tap lands on the wrong button).
- Anything typed by another user (names, gym names, comments, emoji) goes
  through `esc()` before it reaches `innerHTML`.
- Colors come from CSS variables so both themes work; test both.

## Tests

`tests/support/supabase.js` is an in-memory Supabase; `makeDb({ legacy })`
gives a database missing the later migrations. Specs use `check(name, ok)`,
one line per thing a person would notice. New features get checks for:
signed out, signed in, light and dark, and the pre-migration database.
