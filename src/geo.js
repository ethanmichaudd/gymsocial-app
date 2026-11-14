/**
 * Maps and address lookup.
 *
 * The map tiles and the address lookup both come from OpenStreetMap's
 * donated servers, which are free but come with rules. This file is where
 * those rules are kept, so the rest of the app can't break them by accident:
 *
 *   Address lookup (Nominatim) — https://operations.osmfoundation.org/policies/nominatim/
 *     - never more than one request a second: every lookup goes through one
 *       queue with a gap between requests
 *     - every answer is kept on this phone, including "not found", so the
 *       same address is never asked twice
 *     - no search-as-you-type: a lookup only happens for a gym's saved
 *       address, never for what someone is typing in a search box
 *     - it can be switched off or pointed elsewhere without a new release
 *       (the app_config table in supabase/008_gym_places.sql)
 *     - private gyms are never looked up: a home address is personal data
 *
 *   Map tiles — https://operations.osmfoundation.org/policies/tiles/
 *     - "© OpenStreetMap contributors" stays visible on every map
 *     - only what's on screen is fetched; the service worker does not store
 *       tiles (offline use of their tiles isn't allowed)
 *     - the tile address comes from the same app_config row
 *
 * Both services identify the app by the page address the browser sends
 * (the Referer), so don't add a referrer policy that strips it.
 */

const DEFAULTS = {
  geocoding: true,
  geocoderUrl: "https://nominatim.openstreetmap.org/search",
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};

let config = { ...DEFAULTS };

export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/** Takes the "maps" row of app_config. Anything missing or odd keeps the default. */
export function setMapConfig(c) {
  if (!c || typeof c !== "object") return;
  const https = (u) => typeof u === "string" && /^https:\/\/\S+$/.test(u);
  config = {
    geocoding: c.geocoding !== false,
    geocoderUrl: https(c.geocoder_url) ? c.geocoder_url : DEFAULTS.geocoderUrl,
    tileUrl: https(c.tile_url) ? c.tile_url : DEFAULTS.tileUrl,
  };
}

export function mapConfig() {
  return config;
}

/* =========================================================================
   Address -> coordinates
   ========================================================================= */

const CACHE_KEY = "gymsocial_geocode_v1";
const MIN_GAP_MS = 1100;                        // a little over the 1/second limit
const MISS_DAYS = 30;                           // ask again about a "not found" after a month
const BACKOFF_MS = 10 * 60 * 1000;              // told to slow down: stop for ten minutes

let cache = null;
let lastStart = 0;
let blockedUntil = 0;
let queue = Promise.resolve();

function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; }
  catch (e) { cache = {}; }
  return cache;
}

function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* kept in memory */ }
}

const tidy = (s) => String(s || "").trim().replace(/\s+/g, " ");
const keyOf = (q) => tidy(q).toLowerCase();

/** What's already known for a query: { lat, lng }, null (not found), or undefined (never asked). */
function remembered(query) {
  const hit = loadCache()[keyOf(query)];
  if (!hit) return undefined;
  if (hit.miss) return Date.now() - hit.t < MISS_DAYS * 864e5 ? null : undefined;
  return { lat: hit.lat, lng: hit.lng };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One lookup. Resolves to { lat, lng } or null; rejects if the service couldn't be reached. */
function lookUp(query) {
  const known = remembered(query);
  if (known !== undefined) return Promise.resolve(known);
  if (!config.geocoding) return Promise.resolve(null);

  const job = queue.then(async () => {
    // someone ahead in the queue may have asked the same thing
    const again = remembered(query);
    if (again !== undefined) return again;
    if (Date.now() < blockedUntil) throw new Error("Address lookup is paused.");

    const gap = lastStart + MIN_GAP_MS - Date.now();
    if (gap > 0) await wait(gap);
    lastStart = Date.now();

    const url = config.geocoderUrl + (config.geocoderUrl.includes("?") ? "&" : "?") +
      "format=jsonv2&limit=1&q=" + encodeURIComponent(tidy(query));
    const res = await fetch(url);
    if (res.status === 429 || res.status === 403) blockedUntil = Date.now() + BACKOFF_MS;
    if (!res.ok) throw new Error("Address lookup failed (" + res.status + ").");

    const rows = await res.json();
    const first = Array.isArray(rows) ? rows[0] : null;
    const lat = first ? Number(first.lat) : NaN;
    const lng = first ? Number(first.lon) : NaN;
    const found = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    loadCache()[keyOf(query)] = found ? { lat, lng, t: Date.now() } : { miss: true, t: Date.now() };
    saveCache();
    return found ? { lat, lng } : null;
  });
  // a failed lookup must not jam the queue for the next one
  queue = job.catch(() => {});
  return job;
}

/* The street address first; failing that, the gym's name in its city, which
   finds most chains and campus gyms. Without a city there is nothing precise
   enough to look up. */
function queriesFor(gym) {
  const place = [tidy(gym.city), tidy(gym.state)].filter(Boolean).join(", ");
  if (!tidy(gym.city)) return [];
  const out = [];
  if (tidy(gym.street)) out.push(tidy(gym.street) + ", " + place);
  if (tidy(gym.name)) out.push(tidy(gym.name) + ", " + place);
  return out;
}

/** True when a lookup could tell us something we don't already know. */
export function canLocate(gym) {
  if (!gym || gym.private || !config.geocoding) return false;
  const qs = queriesFor(gym);
  for (const q of qs) {
    const known = remembered(q);
    if (known === undefined) return true;     // never asked
    if (known) return true;                   // already found: free to return
  }
  return false;
}

/** Where a gym is, from its address: { lat, lng } or null. At most two requests, ever, per address. */
export async function locateGym(gym) {
  if (!gym || gym.private) return null;
  for (const q of queriesFor(gym)) {
    const hit = await lookUp(q);
    if (hit) return hit;
  }
  return null;
}

/* =========================================================================
   Distance
   ========================================================================= */

export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "0.4 mi", "12 mi". */
export function formatDistance(km) {
  const mi = km * 0.621371;
  if (mi < 0.1) return "0.1 mi";
  return (mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi)) + " mi";
}

/* =========================================================================
   Is this the same gym?
   Two people typing the same place rarely type it the same way, so before a
   new gym is added it's compared with the ones already known.
   ========================================================================= */

const FILLER = { the: 1, gym: 1, gyms: 1, fitness: 1, club: 1, center: 1, centre: 1, and: 1, at: 1, of: 1 };

function words(name) {
  const all = keyOf(name).replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, "").split(" ").filter(Boolean);
  const core = all.filter((w) => !FILLER[w]);
  return core.length ? core : all;
}

/** 0 (nothing alike) to 1 (same name). */
export function nameLikeness(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return 0;
  if (A.join(" ") === B.join(" ")) return 1;
  const inB = {};
  B.forEach((w) => { inB[w] = 1; });
  const shared = A.filter((w) => inB[w]).length;
  const union = new Set(A.concat(B)).size;
  let score = shared / union;
  // "Planet Fitness" vs "Planet Fitness Boston": one name inside the other
  if (shared === Math.min(A.length, B.length)) score = Math.max(score, 0.8);
  return score;
}

const same = (a, b) => keyOf(a) === keyOf(b);

/**
 * The known gym most likely to be the one being added, or null.
 * Returns { gym, exact }: exact means name and full address already match.
 */
export function closestGym(fields, known) {
  let best = null;
  (known || []).forEach((g) => {
    // a different city (or state) is a different gym, however alike the names
    if (tidy(fields.city) && tidy(g.city) && !same(fields.city, g.city)) return;
    if (tidy(fields.state) && tidy(g.state) && !same(fields.state, g.state)) return;
    const exact = same(fields.name, g.name) && same(fields.street, g.street) &&
      same(fields.city, g.city) && same(fields.state, g.state);
    let score = exact ? 2 : nameLikeness(fields.name, g.name);
    // same chain, same city, but two different street addresses: two branches
    if (!exact && tidy(fields.street) && tidy(g.street) && !same(fields.street, g.street)) score -= 0.25;
    if (score >= 0.6 && (!best || score > best.score)) best = { gym: g, exact, score };
  });
  return best ? { gym: best.gym, exact: best.exact } : null;
}
