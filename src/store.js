/**
 * Where your training data lives.
 *
 * This device keeps a full copy in localStorage, so the app opens instantly
 * and works offline. Once you sign in, that copy is mirrored to your
 * Supabase account: every save is pushed up a moment later, and opening the
 * app (or tapping "Sync now") pulls down anything another phone changed.
 *
 * The rest of the app still only calls loadState / saveState. It never has
 * to know whether the cloud is there.
 *
 * What syncs: your profile and settings, your gyms, your exercises, your
 * workouts (with their sets and photo), plus the social side — friends,
 * friend requests, friends' recent workouts and everyone's reactions.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_DOMAIN } from "./config.js";

const PHOTO_BUCKET = "workout-photos";
const META_KEY = "gymsocial_sync_v1";         // what this device last synced
const PUSH_DELAY_MS = 1200;                     // batch quick edits into one push
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7;    // photo links last a week

export const supabase = cloudEnabled()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/* =========================================================================
   Local copy
   ========================================================================= */

export function loadState(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    // Private browsing, blocked storage, corrupt JSON — start fresh in memory
    console.warn("Could not read saved data:", err);
    return null;
  }
}

export function saveState(key, state) {
  let ok = true;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (err) {
    console.warn("Could not save:", err);
    ok = false;
  }
  if (sync.user) schedulePush();
  return ok;
}

/** True once Supabase credentials are present. */
export function cloudEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY.length > 20);
}

/* =========================================================================
   Accounts
   ========================================================================= */

/** The signed-in user ({ id, email }) or null. */
export function currentUser() {
  return sync.user;
}

/* Accounts are a username + password. Supabase still wants an email under
   the hood, so a username becomes a placeholder address on a domain nobody
   receives mail for -- with "Confirm email" off, nothing is ever sent.
   Anything typed with an @ in it is treated as a real email, so accounts
   made that way still sign in. */
function loginEmail(id) {
  const v = String(id || "").trim().toLowerCase().replace(/^@/, "");
  return v.includes("@") ? v : v + "@" + LOGIN_DOMAIN;
}

/** True for accounts that sign in with a username rather than an email. */
export function usesUsernameLogin(user) {
  return Boolean(user && user.email && user.email.endsWith("@" + LOGIN_DOMAIN));
}

export async function signIn(id, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail(id), password });
  if (error) {
    if (/invalid login/i.test(error.message)) throw new Error("Wrong username or password.");
    throw error;
  }
  if (await isDeveloperAccount(data.user && data.user.id)) {
    await supabase.auth.signOut();
    throw new Error("That\u2019s the developer account. It only works on the developer page.");
  }
  return data.user;
}

/* A developer account (supabase/010_admin.sql) is for the developer page
   only: the app turns it away, and the database refuses its workouts
   anyway. One question per account; "no" is remembered on this device so
   opening the app doesn't ask again. */
const NOT_DEV_KEY = "gymsocial_notdev_v1";
const devChecks = {};

function isDeveloperAccount(uid) {
  if (!supabase || !uid) return Promise.resolve(false);
  try { if (localStorage.getItem(NOT_DEV_KEY) === uid) return Promise.resolve(false); } catch (e) { /* no storage */ }
  if (!devChecks[uid]) {
    devChecks[uid] = Promise.resolve(supabase.rpc("is_admin")).then(({ data, error }) => {
      // before 010 has been run there is no such function: nobody is a developer
      if (!error && data === false) { try { localStorage.setItem(NOT_DEV_KEY, uid); } catch (e) { /* full */ } }
      return !error && data === true;
    }).catch(() => false).finally(() => { delete devChecks[uid]; });   // only shared while in flight
  }
  return devChecks[uid];
}

/** Returns true if the project still asks for email confirmation. */
export async function signUp(username, password) {
  const name = String(username || "").trim().toLowerCase().replace(/^@/, "");
  if (!USERNAME_RULE.test(name)) throw new Error("Usernames are 3\u201320 lowercase letters, numbers, _ or .");
  const { data, error } = await supabase.auth.signUp({ email: loginEmail(name), password });
  if (error) {
    // already an account with that login, or the profile trigger hit a
    // username someone else already has
    if (/already registered|already exists|database error/i.test(error.message)) {
      throw new Error("@" + name + " is taken. Try another.");
    }
    throw error;
  }
  return !data.session;
}

/**
 * Signing out forgets this device's copy, so the next person to sign in on
 * it doesn't inherit your workouts. Everything synced is safe in the cloud.
 */
export async function signOut(storageKey) {
  // stop this phone getting the old account's notifications
  try { await disablePush(); } catch (e) { /* not subscribed */ }
  // and don't leave "at the gym" showing for an account nobody is signed in to
  try { await clearPresence(); } catch (e) { /* nothing to clear */ }
  // a deleted or expired session can make this fail; sign out locally anyway
  try { await supabase.auth.signOut(); }
  catch (e) { await supabase.auth.signOut({ scope: "local" }).catch(() => {}); }
  try {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(META_KEY);
  } catch (e) { /* nothing to clear */ }
  location.reload();
}

/* =========================================================================
   Sync engine
   ========================================================================= */

const sync = {
  user: null,
  getState: null,      // () => the app's live state object
  onChange: null,      // called after a pull changed what's on screen
  onStatus: null,      // called whenever the status line should update
  status: "off",       // off | syncing | synced | offline | error
  lastSynced: null,
  pushTimer: null,
  running: null,       // the in-flight push/pull, so two never overlap
  again: false,        // a save landed mid-push: push once more after
};

export function syncStatus() {
  return { status: sync.status, lastSynced: sync.lastSynced, user: sync.user };
}

function setStatus(s) {
  sync.status = s;
  if (s === "synced") sync.lastSynced = new Date();
  if (sync.onStatus) sync.onStatus(syncStatus());
}

/**
 * Called once by the app at startup. Watches the session and runs a full
 * sync whenever someone signs in or the app comes back to the foreground.
 */
export function startSync({ getState, onChange, onStatus }) {
  sync.getState = getState;
  sync.onChange = onChange;
  sync.onStatus = onStatus;
  if (!supabase) return;

  supabase.auth.onAuthStateChange((event, session) => {
    const before = sync.user && sync.user.id;
    sync.user = session ? { id: session.user.id, email: session.user.email } : null;
    if (!sync.user) { setStatus("off"); return; }
    // the listener must not await Supabase calls itself, so hop off it
    if (sync.user.id !== before) {
      const uid = sync.user.id;
      setTimeout(() => {
        isDeveloperAccount(uid).then((dev) => {
          if (dev) { supabase.auth.signOut(); return; }
          if (!sync.user || sync.user.id !== uid) return;
          syncNow();
          refreshPushSubscription();
        });
      }, 0);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && sync.user) syncNow();
  });
  window.addEventListener("online", () => { if (sync.user) syncNow(); });
}

/** Push what changed here, then pull what changed elsewhere. */
export function syncNow() {
  return runExclusive(async () => {
    await pushAll();
    await pullAll();
    await pullSocial();
  });
}

function schedulePush() {
  clearTimeout(sync.pushTimer);
  sync.pushTimer = setTimeout(() => {
    if (sync.running) { sync.again = true; return; }
    runExclusive(pushAll);
  }, PUSH_DELAY_MS);
}

async function runExclusive(job) {
  if (!sync.user) return;
  if (sync.running) { sync.again = true; return sync.running; }
  setStatus("syncing");
  sync.running = (async () => {
    try {
      await job();
      while (sync.again) { sync.again = false; await pushAll(); }
      setStatus("synced");
    } catch (err) {
      console.warn("Sync failed:", err);
      setStatus(navigator.onLine === false ? "offline" : "error");
    } finally {
      sync.running = null;
    }
  })();
  return sync.running;
}

/* ---------- bookkeeping: what this device knows the cloud already has ---------- */

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) || "null");
    if (m && m.userId === sync.user.id) return m;
  } catch (e) { /* start over */ }
  return { userId: sync.user.id, workouts: {}, gyms: {}, exercises: {}, profile: null, photos: {} };
}

function saveMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* best effort */ }
}

function persistLocal(state) {
  try { localStorage.setItem("gymsocial_v1", JSON.stringify(state)); } catch (e) { /* full */ }
}

/* ---------- ids ---------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => typeof s === "string" && UUID_RE.test(s);

export function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Makes this device's data belong to the signed-in account: "me" becomes
 * your account id, and anything made before sign-in gets a real uuid so the
 * database will take it. Safe to run every time; it only changes what needs it.
 */
function adoptIntoAccount(state) {
  const uid = sync.user.id;
  const oldMe = state.me.id;

  // This phone's copy belongs to a DIFFERENT account (it signed in here
  // before). That data is already safe in its own account, and can't be
  // re-uploaded as yours, so start clean and let the pull fill in yours.
  if (isUuid(oldMe) && oldMe !== uid) {
    state.workouts = [];
    state.exercises = [];
    state.gyms = [];
    state.foreignGyms = [];
    state.foreignExercises = [];
    state.follows = [];
    state.connections = [];
    state.friendRequests = { incoming: [], outgoing: [] };
    state.gymDirectory = [];
    state.inbox = [];
    state.inboxPeople = [];
    state.users = [state.me];
    Object.assign(state.me, { id: uid, name: "You", handle: "", avatar: null, isPrivate: false });
    try { localStorage.removeItem(META_KEY); } catch (e) { /* nothing to clear */ }
    return;
  }

  if (oldMe !== uid) {
    const swap = (id) => (id === oldMe ? uid : id);
    state.me.id = uid;
    (state.users || []).forEach((u) => { if (u.id === oldMe) u.id = uid; });
    (state.workouts || []).forEach((w) => {
      w.userId = swap(w.userId);
      Object.keys(w.reactions || {}).forEach((e) => { w.reactions[e] = w.reactions[e].map(swap); });
    });
    ["follows", "connections", "connectionRequests"].forEach((k) => {
      state[k] = (state[k] || []).map((pair) => pair.map(swap));
    });
  }

  (state.exercises || []).forEach((ex) => {
    if (!isUuid(ex.id)) remapExercise(state, ex.id, newId());
  });
  (state.gyms || []).forEach((g) => {
    if (!isUuid(g.id)) remapGym(state, g.id, newId());
  });
  (state.workouts || []).forEach((w) => {
    if (w.userId === uid && !isUuid(w.id)) w.id = newId();
  });
}

function remapExercise(state, from, to) {
  if (from === to) return;
  const ex = state.exercises.find((e) => e.id === from);
  if (ex) ex.id = to;
  state.workouts.forEach((w) => w.exercises.forEach((b) => { if (b.exerciseId === from) b.exerciseId = to; }));
}

function remapGym(state, from, to) {
  if (from === to) return;
  const g = state.gyms.find((x) => x.id === from);
  if (g) g.id = to;
  state.workouts.forEach((w) => { if (w.gymId === from) w.gymId = to; });
}

/* ---------- fingerprints: has this thing changed since it was synced? ---------- */

function workoutPrint(w) {
  const print = workoutBasePrint(w);
  // tags only when there are some, so workouts synced before tagging existed
  // don't all look changed
  if (w.withIds && w.withIds.length) print.push(["with"].concat(w.withIds.slice().sort()));
  // records too, only when there are some (older workouts' prints don't change)
  if (w.prs && w.prs.length) print.push(["prs"].concat(w.prs.map((p) => p.name + "|" + p.display)));
  return JSON.stringify(print);
}

function workoutBasePrint(w) {
  return [
    w.gymId || null, w.title || null, w.performedAt, w.endedAt || null, w.calories ?? null,
    w.photoPath || null, Boolean(w.photoData),
    w.exercises.map((b) => [
      b.exerciseId, b.metric || "reps", b.equipment || null, b.note || null, b.superset || null,
      b.sets.map((s) => {
        const p = [s.reps ?? null, s.seconds ?? null, s.weight ?? null, s.distance ?? null,
                   s.unit || "lb", s.distUnit || "mi"];
        // cardio extras only when used, so older workouts' prints don't change
        if (s.intensity != null || s.heartRate != null || s.steps != null) {
          p.push(s.intensity ?? null, s.heartRate ?? null, s.steps ?? null);
        }
        if (s.drop) p.push("drop");            // only when used, like the cardio extras
        return p;
      }),
    ]),
  ];
}

// "private" is only in the print when it's on, so gyms synced before it
// existed don't all look changed
const gymPrint = (g) => JSON.stringify(
  [g.name, g.street || "", g.city || "", g.state || ""].concat(g.private ? ["private"] : []));

/* Coordinates, the private flag and the gym functions arrive with
   supabase/008_gym_places.sql. Until it has been run the database answers
   "no such column" / "no such function"; these tell that apart from a real
   failure so everything else keeps syncing. */
const missingColumn = (err) => !!err && (err.code === "PGRST204" || err.code === "42703");
const missingFunction = (err) => !!err &&
  (err.code === "PGRST202" || /could not find the function/i.test(err.message || ""));
const missingTable = (err) => !!err &&
  (err.code === "PGRST205" || err.code === "42P01" || /could not find the table/i.test(err.message || ""));
const hasPin = (g) => g.lat != null && g.lng != null;
const exercisePrint = (e) => JSON.stringify([e.name, e.category || null, e.metric || "reps"]);

function profileRow(state) {
  const me = state.me;
  const st = state.settings || {};
  const { weeklyGoal, streakMode, customCount, customDays, ...rest } = st;
  return {
    display_name: me.name && me.name !== "You" ? me.name : null,
    is_private: Boolean(me.isPrivate),
    avatar: me.avatar || null,
    weekly_goal: weeklyGoal ?? 3,
    streak_mode: streakMode || "weekly",
    custom_count: customCount ?? 4,
    custom_days: customDays ?? 10,
    settings: rest,
  };
}

/**
 * Copies the account's profile row onto this device. Returns false when
 * this phone still holds something newer that has to go up (see below).
 */
function applyProfile(state, p) {
  const uid = sync.user.id;
  const me = state.me;
  if (p.display_name) me.name = p.display_name;
  me.handle = p.username;
  me.isPrivate = p.is_private;
  me.avatar = p.avatar || null;
  // "last looked at the Inbox" only ever moves forward: if this phone
  // looked more recently than the cloud knows, keep that and push it up
  const seenHere = state.settings.inboxSeenAt || "";
  Object.assign(state.settings, p.settings || {}, {
    weeklyGoal: p.weekly_goal, streakMode: p.streak_mode,
    customCount: p.custom_count, customDays: p.custom_days,
  });
  const seenAhead = seenHere > (state.settings.inboxSeenAt || "");
  if (seenAhead) state.settings.inboxSeenAt = seenHere;
  const meRow = (state.users || []).find((u) => u.id === uid);
  if (meRow) Object.assign(meRow, { name: me.name, handle: me.handle, isPrivate: me.isPrivate, avatar: me.avatar });
  return !seenAhead;
}

/* =========================================================================
   Push: this device -> cloud
   ========================================================================= */

async function pushAll() {
  const state = sync.getState();
  const uid = sync.user.id;
  const meta = loadMeta();

  adoptIntoAccount(state);

  // ---- profile ----
  // A phone that has never synced this account's profile only has defaults
  // ("You", no photo, light theme). Sending those would wipe the name, photo
  // and settings the account already has, so take the account's copy first.
  // The exception is a brand-new account -- its settings are still empty --
  // where whatever was set up on this phone before signing in is the profile.
  if (meta.profile == null) {
    const cur = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    if (cur.error) throw cur.error;
    if (cur.data && Object.keys(cur.data.settings || {}).length) {
      if (applyProfile(state, cur.data)) meta.profile = JSON.stringify(profileRow(state));
      if (sync.onChange) sync.onChange();      // the theme and name show up right away
    }
  }
  const prof = profileRow(state);
  const profPrint = JSON.stringify(prof);
  if (meta.profile !== profPrint) {
    const { data, error } = await supabase.from("profiles").update(prof).eq("id", uid).select("id");
    if (error) throw error;
    if (!data.length) {
      // the signup trigger normally makes this row; cover for it if it didn't
      const username = (sync.user.email || "user").split("@")[0] + "_" + uid.slice(0, 4);
      const ins = await supabase.from("profiles").insert({ id: uid, username, ...prof });
      if (ins.error) throw ins.error;
    }
    meta.profile = profPrint;
  }

  // ---- gyms (a shared directory: reuse a matching one rather than duplicate) ----
  for (const g of state.gyms) {
    const print = gymPrint(g);
    if (meta.gyms[g.id] === print) continue;
    const row = { name: g.name, street: g.street || "", city: g.city || "", state: g.state || "" };
    if (!meta.gyms[g.id]) {
      const found = await supabase.from("gyms").select("id")
        .eq("name", row.name).eq("street", row.street).eq("city", row.city).eq("state", row.state)
        .maybeSingle();
      if (found.error) throw found.error;
      if (found.data) {
        const oldId = g.id;
        remapGym(state, oldId, found.data.id);
        meta.gyms[g.id] = print;
        continue;
      }
      const extra = {};
      if (g.private) extra.is_private = true;
      if (hasPin(g)) { extra.lat = g.lat; extra.lng = g.lng; }
      let ins = await supabase.from("gyms").insert({ id: g.id, created_by: uid, ...row, ...extra });
      if (missingColumn(ins.error)) {
        ins = await supabase.from("gyms").insert({ id: g.id, created_by: uid, ...row });
      } else if (!ins.error && hasPin(g)) {
        delete g.locDirty;                       // the pin went up with the gym
      }
      if (ins.error) throw ins.error;
    } else {
      // editing only sticks on gyms you added; RLS quietly skips the rest
      const extra = g.private === undefined ? {} : { is_private: Boolean(g.private) };
      let up = await supabase.from("gyms").update({ ...row, ...extra }).eq("id", g.id);
      if (missingColumn(up.error)) up = await supabase.from("gyms").update(row).eq("id", g.id);
      if (up.error) throw up.error;
    }
    meta.gyms[g.id] = print;
  }

  // ---- exercises (one per name per account) ----
  const changedEx = state.exercises.filter((e) => meta.exercises[e.id] !== exercisePrint(e));
  if (changedEx.length) {
    const mine = await supabase.from("exercises").select("id,name").eq("owner_id", uid);
    if (mine.error) throw mine.error;
    const byName = {};
    mine.data.forEach((r) => { byName[r.name.toLowerCase()] = r.id; });
    for (const ex of changedEx) {
      const existing = byName[ex.name.toLowerCase()];
      if (existing && existing !== ex.id) remapExercise(state, ex.id, existing);
      const up = await supabase.from("exercises").upsert({
        id: ex.id, owner_id: uid, name: ex.name,
        category: ex.category || null, metric: ex.metric || "reps",
      });
      if (up.error) throw up.error;
      meta.exercises[ex.id] = exercisePrint(ex);
    }
  }

  // ---- workouts ----
  const mineNow = state.workouts.filter((w) => w.userId === uid);
  for (const w of mineNow) {
    if (meta.workouts[w.id] === workoutPrint(w)) continue;
    await pushPhoto(w, meta);
    await pushWorkout(w);
    await pushTags(w);
    meta.workouts[w.id] = workoutPrint(w);
    saveMeta(meta);
  }

  // ---- deletions: synced before, gone from this device now ----
  const here = new Set(mineNow.map((w) => w.id));
  for (const id of Object.keys(meta.workouts)) {
    if (here.has(id)) continue;
    const del = await supabase.from("workouts").delete().eq("id", id);
    if (del.error) throw del.error;
    if (meta.photos[id]) {
      await supabase.storage.from(PHOTO_BUCKET).remove([meta.photos[id]]);
      delete meta.photos[id];
    }
    delete meta.workouts[id];
  }

  saveMeta(meta);
  await pushGymPins(state);
  persistLocal(state);
}

/* A pin this phone placed or moved (locDirty) goes up through
   set_gym_location, which also decides who may move one. Last, and never
   fatal: a pin is not worth holding up your workouts for. */
async function pushGymPins(state) {
  if (sync.noGymPins) return;
  for (const g of state.gyms) {
    if (!g.locDirty || !hasPin(g) || !isUuid(g.id)) continue;
    const { error } = await supabase.rpc("set_gym_location", { p_gym: g.id, p_lat: g.lat, p_lng: g.lng });
    if (!error) { delete g.locDirty; continue; }
    if (missingFunction(error)) { sync.noGymPins = true; return; }   // 008 not run yet: keep it for later
    if (error.code === "P0001") { delete g.locDirty; continue; }     // the database said no; don't keep asking
    console.warn("Gym pin:", error);
    return;
  }
}

async function pushWorkout(w) {
  const row = {
    id: w.id, user_id: sync.user.id, gym_id: w.gymId || null, title: w.title || null,
    performed_at: w.performedAt, ended_at: w.endedAt || null, calories: w.calories ?? null,
    photo_path: w.photoPath || null,
  };
  // the records it set, so friends' feeds can show them (supabase/012_feed.sql);
  // only sent when there are some, and dropped if the column isn't there yet
  if (!sync.noHighlights && Array.isArray(w.prs) && w.prs.length) row.highlights = w.prs;
  let up = await supabase.from("workouts").upsert(row);
  if (up.error && row.highlights && missingColumn(up.error)) {
    sync.noHighlights = true;
    delete row.highlights;
    up = await supabase.from("workouts").upsert(row);
  }
  if (up.error) throw up.error;

  // Children are rewritten whole: simpler than diffing sets, and a session
  // is only a few dozen rows.
  const del = await supabase.from("workout_exercises").delete().eq("workout_id", w.id);
  if (del.error) throw del.error;

  const blocks = w.exercises.map((b, i) => ({
    id: newId(), workout_id: w.id, exercise_id: b.exerciseId, order_index: i,
    metric: b.metric || "reps", equipment: b.equipment || null,
    note: b.note || null, superset_group: b.superset || null,
  }));
  if (!blocks.length) return;
  const insB = await supabase.from("workout_exercises").insert(blocks);
  if (insB.error) throw insB.error;

  // Cardio's extra columns (supabase/006_cardio.sql) are only sent when a
  // set uses them, so lifting keeps syncing on a database without them.
  const cardioCols = w.exercises.some((b) => b.sets.some((s) =>
    s.intensity != null || s.heartRate != null || s.steps != null));
  // Same idea for drop sets (supabase/011_drop_sets.sql).
  const dropCol = w.exercises.some((b) => b.sets.some((s) => s.drop));
  const sets = [];
  w.exercises.forEach((b, i) => b.sets.forEach((s, n) => {
    const row = {
      workout_exercise_id: blocks[i].id, set_number: n + 1,
      reps: s.reps ?? null, seconds: s.seconds ?? null, weight: s.weight ?? null,
      weight_unit: s.unit || "lb", distance: s.distance ?? null, distance_unit: s.distUnit || "mi",
    };
    if (cardioCols) {
      row.intensity = s.intensity ?? null;
      row.heart_rate = s.heartRate ?? null;
      row.steps = s.steps ?? null;
    }
    if (dropCol) row.is_drop = Boolean(s.drop);
    sets.push(row);
  }));
  if (sets.length) {
    let insS = await supabase.from("workout_sets").insert(sets);
    if (dropCol && missingColumn(insS.error)) {
      // before 011 has been run: the sets still go up, without the marker.
      // This phone keeps it (keepDrops) and sends it once the column exists.
      sets.forEach((r) => { delete r.is_drop; });
      insS = await supabase.from("workout_sets").insert(sets);
    }
    if (insS.error) throw insS.error;
  }
}

/* Who you trained with. Only the difference is sent -- re-adding a tag that
   is already there would notify that friend all over again. Never fatal:
   a tag the database refuses (no longer friends) must not block the workout. */
async function pushTags(w) {
  if (sync.noTags || !Array.isArray(w.withIds)) return;
  const want = w.withIds.filter(isUuid);
  const cur = await supabase.from("workout_tags").select("user_id").eq("workout_id", w.id);
  if (cur.error) {
    if (missingTable(cur.error)) { sync.noTags = true; return; }   // 009 not run yet
    throw cur.error;
  }
  const have = cur.data.map((r) => r.user_id);
  const add = want.filter((id) => !have.includes(id));
  const drop = have.filter((id) => !want.includes(id));
  if (add.length) {
    const ins = await supabase.from("workout_tags").insert(add.map((id) => ({ workout_id: w.id, user_id: id })));
    if (ins.error) console.warn("Tags:", ins.error);
  }
  if (drop.length) {
    const del = await supabase.from("workout_tags").delete().eq("workout_id", w.id).in("user_id", drop);
    if (del.error) console.warn("Tags:", del.error);
  }
}

/* A new or replaced photo waits on the workout as photoData until it's
   uploaded; a removed one is photoPath === null with an old path on record. */
async function pushPhoto(w, meta) {
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  const old = meta.photos[w.id] || null;

  if (w.photoData) {
    const path = `${sync.user.id}/${w.id}-${Date.now()}.jpg`;
    const blob = await (await fetch(w.photoData)).blob();
    const up = await bucket.upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw up.error;
    const signed = await bucket.createSignedUrl(path, SIGNED_URL_SECONDS);
    w.photoPath = path;
    w.photoUrl = signed.data ? signed.data.signedUrl : null;
    w.photoUrlExpires = Date.now() + SIGNED_URL_SECONDS * 1000;
    delete w.photoData;
    if (old && old !== path) await bucket.remove([old]);
    meta.photos[w.id] = path;
  } else if (!w.photoPath && old) {
    await bucket.remove([old]);
    delete meta.photos[w.id];
  }
}

/* =========================================================================
   Pull: cloud -> this device
   ========================================================================= */

async function pullAll() {
  const state = sync.getState();
  const uid = sync.user.id;
  const meta = loadMeta();
  let changed = false;

  // ---- profile ----
  const prof = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (prof.error) throw prof.error;
  if (prof.data) {
    if (applyProfile(state, prof.data)) meta.profile = JSON.stringify(profileRow(state));
    changed = true;
  }

  // ---- exercises: same name means same exercise ----
  const ex = await supabase.from("exercises").select("id,name,category,metric").eq("owner_id", uid);
  if (ex.error) throw ex.error;
  ex.data.forEach((r) => {
    const local = state.exercises.find((e) => e.id === r.id) ||
      state.exercises.find((e) => e.name.toLowerCase() === r.name.toLowerCase());
    if (local) {
      remapExercise(state, local.id, r.id);
      Object.assign(local, { name: r.name, category: r.category || local.category, metric: r.metric });
    } else {
      state.exercises.push({ id: r.id, name: r.name, category: r.category || "other", metric: r.metric });
    }
    meta.exercises[r.id] = exercisePrint(state.exercises.find((e) => e.id === r.id));
  });

  // ---- workouts, with their sets ----
  const wk = await supabase.from("workouts")
    .select("*, workout_exercises(*, workout_sets(*))")
    .eq("user_id", uid)
    .order("performed_at", { ascending: false });
  if (wk.error) throw wk.error;

  // ---- gyms those workouts use, plus any you added ----
  const gymIds = [...new Set(wk.data.map((r) => r.gym_id).filter(Boolean))];
  // "my gym" comes along even before you've logged a workout there
  const homeGym = state.settings.homeGymId;
  if (isUuid(homeGym) && !gymIds.includes(homeGym)) gymIds.push(homeGym);
  const gq = supabase.from("gyms").select("*");
  const gy = await (gymIds.length
    ? gq.or(`created_by.eq.${uid},id.in.(${gymIds.join(",")})`)
    : gq.eq("created_by", uid));
  if (gy.error) throw gy.error;
  gy.data.forEach((r) => {
    const g = { id: r.id, name: r.name, street: r.street || "", city: r.city || "", state: r.state || "" };
    const local = state.gyms.find((x) => x.id === r.id);
    if (r.is_private !== undefined) g.private = Boolean(r.is_private);
    // a pin moved on this phone and not yet sent wins over the cloud's
    if (r.lat != null && r.lng != null && !(local && local.locDirty)) {
      g.lat = Number(r.lat);
      g.lng = Number(r.lng);
    }
    if (local) Object.assign(local, g); else state.gyms.push(g);
    meta.gyms[r.id] = gymPrint(g);
  });

  const remoteIds = new Set();
  wk.data.forEach((r) => {
    remoteIds.add(r.id);
    const incoming = workoutFromRow(r, state);
    const i = state.workouts.findIndex((w) => w.id === r.id);
    if (i === -1) {
      state.workouts.push(incoming);
    } else {
      const local = state.workouts[i];
      // unsynced edits on this device win; they go up on the next push
      if (meta.workouts[r.id] && meta.workouts[r.id] !== workoutPrint(local)) return;
      incoming.reactions = local.reactions || {};
      // comments and tags arrive with the social pull, not with the workout row
      if (local.comments) incoming.comments = local.comments;
      if (local.withIds) incoming.withIds = local.withIds;
      if (!incoming.prs && local.prs) incoming.prs = local.prs;   // before 012 the server can't hold them
      if (!rowKnowsDrops(r)) keepDrops(local, incoming);
      if (local.photoPath === incoming.photoPath && local.photoUrl) {
        incoming.photoUrl = local.photoUrl;
        incoming.photoUrlExpires = local.photoUrlExpires;
      }
      state.workouts[i] = incoming;
    }
    meta.workouts[r.id] = workoutPrint(incoming);
    if (incoming.photoPath) meta.photos[r.id] = incoming.photoPath;
  });

  // deleted on another device: it was synced, it's gone from the cloud
  state.workouts = state.workouts.filter((w) => {
    if (w.userId !== uid || remoteIds.has(w.id) || !meta.workouts[w.id]) return true;
    delete meta.workouts[w.id];
    return false;
  });

  if (await followMergedGyms(state, meta)) changed = true;

  await refreshPhotoUrls(state);

  saveMeta(meta);
  persistLocal(state);
  if (changed || wk.data.length) sync.onChange && sync.onChange();
}

/**
 * A developer can merge a duplicate gym into another (010_admin.sql). The
 * database already moved the workouts; this swaps the old gym for the kept
 * one on this phone's own list. Never blocks a sync: on any trouble the
 * list simply stays as it was.
 */
async function followMergedGyms(state, meta) {
  if (sync.noRedirects) return false;
  const ids = state.gyms.map((g) => g.id).filter((id) => isUuid(id) && meta.gyms[id]);
  if (!ids.length) return false;
  let rows = null;
  try {
    const { data, error } = await supabase.rpc("gym_redirects", { p_ids: ids });
    if (error) { if (missingFunction(error)) sync.noRedirects = true; return false; }
    rows = data;
  } catch (e) { return false; }
  if (!Array.isArray(rows) || !rows.length) return false;
  rows.forEach((r) => {
    const kept = { id: r.id, name: r.name, street: r.street || "", city: r.city || "", state: r.state || "" };
    if (r.is_private != null) kept.private = Boolean(r.is_private);
    if (r.lat != null && r.lng != null) { kept.lat = Number(r.lat); kept.lng = Number(r.lng); }
    const old = state.gyms.find((x) => x.id === r.from_id);
    let mine = state.gyms.find((x) => x.id === r.id);
    if (mine) {
      Object.assign(mine, kept);
      state.gyms = state.gyms.filter((x) => x.id !== r.from_id);
    } else if (old) {
      delete old.lat; delete old.lng; delete old.locDirty;
      Object.assign(old, kept);
      mine = old;
    }
    state.workouts.forEach((w) => { if (w.gymId === r.from_id) w.gymId = r.id; });
    if (state.settings.homeGymId === r.from_id) state.settings.homeGymId = r.id;
    delete meta.gyms[r.from_id];
    if (mine) meta.gyms[r.id] = gymPrint(mine);
  });
  return true;
}

/* A database that hasn't run 011 has nowhere to keep "this was a drop set",
   so what comes back has lost it. The copy on this phone still knows. */
const rowKnowsDrops = (r) =>
  (r.workout_exercises || []).some((b) => (b.workout_sets || []).some((s) => "is_drop" in s));

function keepDrops(local, incoming) {
  incoming.exercises.forEach((b, i) => {
    const mine = (local.exercises || [])[i];
    if (!mine || mine.exerciseId !== b.exerciseId || mine.sets.length !== b.sets.length) return;
    b.sets.forEach((s, n) => { if (mine.sets[n].drop) s.drop = true; });
  });
}

/* Records a workout set, as its owner's phone worked them out. Anything that
   isn't the expected shape is dropped rather than drawn. */
function cleanHighlights(h) {
  if (!Array.isArray(h)) return undefined;
  const out = h.filter((p) => p && typeof p.name === "string" && typeof p.display === "string")
    .slice(0, 10)
    .map((p) => ({ name: p.name.slice(0, 80), display: p.display.slice(0, 40),
      delta: typeof p.delta === "string" ? p.delta.slice(0, 40) : "" }));
  return out.length ? out : undefined;
}

function workoutFromRow(r, state) {
  const blocks = (r.workout_exercises || []).slice().sort((a, b) => a.order_index - b.order_index);
  return {
    id: r.id,
    userId: r.user_id,
    userName: ((state.users || []).find((u) => u.id === r.user_id) || state.me).name,
    gymId: r.gym_id,
    title: r.title,
    performedAt: new Date(r.performed_at).toISOString(),
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    calories: r.calories,
    photoPath: r.photo_path || null,
    prs: cleanHighlights(r.highlights),
    reactions: {},
    exercises: blocks.map((b) => {
      const out = {
        exerciseId: b.exercise_id,
        metric: b.metric,
        sets: (b.workout_sets || []).slice().sort((x, y) => x.set_number - y.set_number).map((s) => ({
          reps: s.reps, seconds: s.seconds,
          weight: s.weight == null ? null : Number(s.weight),
          distance: s.distance == null ? null : Number(s.distance),
          unit: s.weight_unit || "lb", distUnit: s.distance_unit || "mi",
          intensity: s.intensity == null ? null : Number(s.intensity),
          heartRate: s.heart_rate ?? null,
          steps: s.steps ?? null,
          ...(s.is_drop ? { drop: true } : {}),
        })),
      };
      if (b.equipment) out.equipment = b.equipment;
      if (b.note) out.note = b.note;
      if (b.superset_group) out.superset = b.superset_group;
      return out;
    }),
  };
}

/** Private bucket, so photos are shown through short-lived signed links. */
async function refreshPhotoUrls(state) {
  const soon = Date.now() + 24 * 3600 * 1000;
  const need = state.workouts.filter((w) => w.photoPath && !w.photoData &&
    (!w.photoUrl || !w.photoUrlExpires || w.photoUrlExpires < soon));
  if (!need.length) return;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET)
    .createSignedUrls(need.map((w) => w.photoPath), SIGNED_URL_SECONDS);
  if (error) { console.warn("Photo links:", error); return; }
  const expires = Date.now() + SIGNED_URL_SECONDS * 1000;
  data.forEach((d, i) => {
    if (d.signedUrl) { need[i].photoUrl = d.signedUrl; need[i].photoUrlExpires = expires; }
  });
}

/* =========================================================================
   Photos
   ========================================================================= */

/**
 * Turns a picked file into a JPEG data URL no bigger than 1280px on its long
 * side — a phone photo straight off the camera would be several megabytes.
 */
export function shrinkPhoto(file, maxSide = 1280) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't an image."));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        try { resolve(canvas.toDataURL("image/jpeg", 0.8)); }
        catch (e) { reject(new Error("Couldn't read that image.")); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** What to put in an <img src> for a workout's photo, or null. */
export function photoSrc(w) {
  return (w && (w.photoData || w.photoUrl)) || null;
}

/* =========================================================================
   Friends
   A friend is a row in connections (mutual). Getting there takes a request
   that the other person accepts. Removing a friend deletes only that row:
   their workouts stay in their account, they just leave your feed.
   ========================================================================= */

const FEED_DAYS = 120;          // how far back friends' workouts are fetched
const SOCIAL_MIN_GAP = 30000;   // don't re-fetch the feed more than every 30s
const DEMO_USERS = ["demo_friend", "demo_friend_2"];

export const USERNAME_RULE = /^[a-z0-9_.]{3,20}$/;

function userFromProfile(p) {
  const u = {
    id: p.id,
    name: p.display_name || p.username,
    handle: p.username,
    avatar: p.avatar || null,
    isPrivate: Boolean(p.is_private),
  };
  // how they count their streak, so you see the same number they do
  if (p.streak_mode) {
    u.streakRule = {
      streakMode: p.streak_mode, weeklyGoal: p.weekly_goal ?? 3,
      customCount: p.custom_count ?? 4, customDays: p.custom_days ?? 10,
    };
  }
  return u;
}

/* Supabase's `in` filter goes in the URL, so long id lists go in batches. */
async function selectIn(table, columns, field, ids, extra) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    let q = supabase.from(table).select(columns).in(field, ids.slice(i, i + 100));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
  }
  return out;
}

/** The stand-in friends were only there to fill the screen before accounts. */
function purgeDemo(state) {
  const gone = new Set(DEMO_USERS);
  state.users = (state.users || []).filter((u) => !gone.has(u.id));
  state.follows = (state.follows || []).filter((f) => !gone.has(f[1]));
  state.workouts = (state.workouts || []).filter((w) => !gone.has(w.userId));
  state.workouts.forEach((w) => {
    Object.keys(w.reactions || {}).forEach((e) => {
      w.reactions[e] = w.reactions[e].filter((id) => !gone.has(id));
      if (!w.reactions[e].length) delete w.reactions[e];
    });
  });
}

const isoOrNull = (t) => {
  const d = t ? new Date(t) : null;
  return d && !isNaN(d) ? d.toISOString() : null;
};

/** Friends, requests, friends' workouts and every reaction on screen. */
async function pullSocial() {
  const state = sync.getState();
  const uid = sync.user.id;
  purgeDemo(state);

  const [conns, reqs] = await Promise.all([
    // "*" rather than named columns: requested_by (007_inbox_reactions.sql)
    // comes along when the database has it and is simply absent when not
    supabase.from("connections").select("*").or(`user_a.eq.${uid},user_b.eq.${uid}`),
    supabase.from("connection_requests").select("from_id,to_id,created_at")
      .or(`from_id.eq.${uid},to_id.eq.${uid}`).order("created_at", { ascending: false }),
  ]);
  if (conns.error) throw conns.error;
  if (reqs.error) throw reqs.error;

  const friendIds = conns.data.map((c) => (c.user_a === uid ? c.user_b : c.user_a));
  const incoming = reqs.data.filter((r) => r.to_id === uid).map((r) => r.from_id);
  const outgoing = reqs.data.filter((r) => r.from_id === uid).map((r) => r.to_id);

  // ---- people ----
  const people = [...new Set([...friendIds, ...incoming, ...outgoing])];
  const profiles = people.length
    ? await selectIn("profiles", "id,username,display_name,avatar,is_private,weekly_goal,streak_mode,custom_count,custom_days", "id", people)
    : [];
  const meRow = (state.users || []).find((u) => u.id === uid) ||
    { id: uid, name: state.me.name, handle: state.me.handle, avatar: state.me.avatar, isPrivate: state.me.isPrivate };
  state.users = [meRow].concat(profiles.map(userFromProfile));
  state.follows = friendIds.map((f) => [uid, f]);
  state.connections = friendIds.map((f) => [uid, f]);
  const requestAt = {};
  reqs.data.forEach((r) => { if (r.to_id === uid) requestAt[r.from_id] = isoOrNull(r.created_at); });
  state.friendRequests = { incoming, outgoing, at: requestAt };

  // ---- friends' recent workouts ----
  let theirs = [];
  if (friendIds.length) {
    const since = new Date(Date.now() - FEED_DAYS * 864e5).toISOString();
    const rows = await selectIn("workouts", "*, workout_exercises(*, workout_sets(*))", "user_id", friendIds,
      (q) => q.gte("performed_at", since).order("performed_at", { ascending: false }).limit(500));
    theirs = rows.map((r) => workoutFromRow(r, state));
  }
  const before = new Map(state.workouts.filter((w) => w.userId !== uid).map((w) => [w.id, w]));
  theirs.forEach((w) => {
    const old = before.get(w.id);
    if (old && old.photoPath === w.photoPath && old.photoUrl) {
      w.photoUrl = old.photoUrl;
      w.photoUrlExpires = old.photoUrlExpires;
    }
  });
  state.workouts = state.workouts.filter((w) => w.userId === uid).concat(theirs);

  // ---- who is at the gym right now (friends who turned that on) ----
  let live = [];
  if (!sync.noPresence && friendIds.length) {
    try {
      const nowIso = new Date().toISOString();
      live = (await selectIn("presence", "*", "user_id", friendIds, (q) => q.gt("expires_at", nowIso)))
        .map((r) => ({ userId: r.user_id, gymId: r.gym_id,
                       startedAt: isoOrNull(r.started_at), expiresAt: isoOrNull(r.expires_at) }));
    } catch (err) {
      if (!missingTable(err)) throw err;
      sync.noPresence = true;                 // 009 not run yet
    }
  }
  state.liveFriends = live;

  // ---- the gyms and exercise names their workouts mention ----
  // Kept apart from yours so they never show up in your own pickers.
  const myGyms = new Set(state.gyms.map((g) => g.id));
  const gymIds = [...new Set(theirs.map((w) => w.gymId).concat(live.map((l) => l.gymId))
    .filter((id) => id && !myGyms.has(id)))];
  state.foreignGyms = gymIds.length
    ? (await selectIn("gyms", "*", "id", gymIds))     // "*": the pin, when the database has one
        .map((r) => ({
          id: r.id, name: r.name, street: r.street || "", city: r.city || "", state: r.state || "",
          lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
        }))
    : [];

  const myEx = new Set(state.exercises.map((e) => e.id));
  const exIds = [...new Set(theirs.flatMap((w) => w.exercises.map((b) => b.exerciseId)).filter((id) => !myEx.has(id)))];
  state.foreignExercises = exIds.length
    ? (await selectIn("exercises", "id,name,category,metric", "id", exIds))
        .map((r) => ({ id: r.id, name: r.name, category: r.category || "other", metric: r.metric }))
    : [];

  // ---- reactions: one per person per workout ----
  const wkIds = state.workouts.map((w) => w.id).filter(isUuid);
  const reacts = wkIds.length
    ? await selectIn("reactions", "*", "workout_id", wkIds)   // "*": created_at if it's there
    : [];
  const byWorkout = {};
  reacts.forEach((r) => {
    const all = (byWorkout[r.workout_id] = byWorkout[r.workout_id] || {});
    (all[r.emoji] = all[r.emoji] || []).push(r.user_id);
  });
  state.workouts.forEach((w) => { w.reactions = byWorkout[w.id] || {}; });

  // ---- comments (supabase/009_social.sql; skipped until it has been run) ----
  let comments = [];
  if (!sync.noComments && wkIds.length) {
    try {
      comments = await selectIn("comments", "*", "workout_id", wkIds, (q) => q.order("created_at"));
      const thread = {};
      comments.forEach((c) => {
        (thread[c.workout_id] = thread[c.workout_id] || []).push(
          { id: c.id, userId: c.user_id, body: c.body, at: isoOrNull(c.created_at) });
      });
      Object.values(thread).forEach((list) => list.sort((a, b) => (a.at || "").localeCompare(b.at || "")));
      state.workouts.forEach((w) => { w.comments = thread[w.id] || []; });
    } catch (err) {
      if (!missingTable(err)) throw err;
      sync.noComments = true;
    }
  }

  // ---- who trained with whom ----
  let tags = [];
  if (!sync.noTags && wkIds.length) {
    try {
      tags = await selectIn("workout_tags", "*", "workout_id", wkIds);
      const withBy = {};
      tags.forEach((t) => { (withBy[t.workout_id] = withBy[t.workout_id] || []).push(t.user_id); });
      const meta = loadMeta();
      state.workouts.forEach((w) => {
        const next = withBy[w.id] || [];
        if (w.userId !== uid) { w.withIds = next; return; }
        // yours: an edit that hasn't gone up yet keeps its own list. Otherwise
        // take the cloud's and note it as synced, so it isn't pushed straight back.
        if (meta.workouts[w.id] !== workoutPrint(w)) return;
        w.withIds = next;
        meta.workouts[w.id] = workoutPrint(w);
      });
      saveMeta(meta);
    } catch (err) {
      if (!missingTable(err)) throw err;
      sync.noTags = true;
    }
  }

  // what this database can do, so screens can hide what it can't yet
  state.features = { comments: !sync.noComments, tags: !sync.noTags, live: !sync.noPresence };

  // ---- inbox: what happened to you -- reactions and comments on your
  //      workouts, workouts you were tagged in, and friendships that came
  //      through. Requests are listed from above. ----
  const mineIds = new Set(state.workouts.filter((w) => w.userId === uid).map((w) => w.id));
  const ownerOf = {};
  state.workouts.forEach((w) => { ownerOf[w.id] = w.userId; });
  const inbox = [];
  comments.forEach((c) => {
    if (c.user_id === uid || !mineIds.has(c.workout_id)) return;
    inbox.push({ kind: "comment", userId: c.user_id, workoutId: c.workout_id,
                 text: String(c.body || "").slice(0, 120), at: isoOrNull(c.created_at) });
  });
  tags.forEach((t) => {
    if (t.user_id !== uid || !ownerOf[t.workout_id] || ownerOf[t.workout_id] === uid) return;
    inbox.push({ kind: "tag", userId: ownerOf[t.workout_id], workoutId: t.workout_id, at: isoOrNull(t.created_at) });
  });
  reacts.forEach((r) => {
    if (r.user_id === uid || !mineIds.has(r.workout_id)) return;
    inbox.push({ kind: "reaction", userId: r.user_id, workoutId: r.workout_id,
                 emoji: r.emoji, at: isoOrNull(r.created_at) });
  });
  conns.data.forEach((c) => {
    const other = c.user_a === uid ? c.user_b : c.user_a;
    if (c.requested_by === other) return;     // you accepted theirs: not news to you
    // without requested_by (older friendships) nobody knows who asked
    inbox.push({ kind: c.requested_by === uid ? "accepted" : "friends",
                 userId: other, at: isoOrNull(c.created_at) });
  });
  inbox.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  state.inbox = inbox.slice(0, 60);

  // someone who reacted or commented without being your friend (a public
  // account's workout, or a friend's friend on a workout you can both see)
  const known = new Set(state.users.map((u) => u.id));
  const strangers = [...new Set(state.inbox.map((i) => i.userId).concat(comments.map((c) => c.user_id))
    .filter((id) => !known.has(id)))];
  state.inboxPeople = strangers.length
    ? (await selectIn("profiles", "id,username,display_name,avatar,is_private", "id", strangers)).map(userFromProfile)
    : [];

  await refreshPhotoUrls(state);
  persistLocal(state);
  sync.lastSocial = Date.now();
  if (sync.onChange) sync.onChange();
}

/** Re-fetch the social side. Throttled unless `force` (after you act). */
export async function refreshSocial(force) {
  if (!sync.user) return;
  if (!force && Date.now() - (sync.lastSocial || 0) < SOCIAL_MIN_GAP) return;
  if (sync.running) { try { await sync.running; } catch (e) { /* its own error */ } }
  return runExclusive(pullSocial);
}

/** Find people by username (or display name). Excludes you. */
export async function searchPeople(query) {
  const q = String(query || "").trim().toLowerCase().replace(/^@/, "");
  if (q.length < 2) return [];
  // _ is a wildcard to LIKE, so escape it; strip anything a username can't hold
  const handle = q.replace(/[^a-z0-9_.]/g, "").replace(/_/g, "\\_");
  const name = q.replace(/[%_\\]/g, "");
  const cols = "id,username,display_name,avatar,is_private";
  const [a, b] = await Promise.all([
    handle ? supabase.from("profiles").select(cols).ilike("username", handle + "%").neq("id", sync.user.id).limit(15)
           : Promise.resolve({ data: [] }),
    name ? supabase.from("profiles").select(cols).ilike("display_name", "%" + name + "%").neq("id", sync.user.id).limit(15)
         : Promise.resolve({ data: [] }),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  const seen = new Set();
  return [...a.data, ...b.data]
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map(userFromProfile);
}

export async function sendFriendRequest(userId) {
  const reqs = sync.getState().friendRequests || { incoming: [] };
  // they already asked you: sending back just means yes
  if (reqs.incoming.includes(userId)) return acceptFriendRequest(userId);
  const { error } = await supabase.from("connection_requests")
    .insert({ from_id: sync.user.id, to_id: userId });
  if (error && error.code !== "23505") throw error;   // 23505: already sent
  await refreshSocial(true);
}

export async function acceptFriendRequest(userId) {
  const { error } = await supabase.rpc("accept_friend_request", { requester: userId });
  if (error) throw error;
  await refreshSocial(true);
}

export async function declineFriendRequest(userId) {
  const { error } = await supabase.from("connection_requests").delete()
    .eq("from_id", userId).eq("to_id", sync.user.id);
  if (error) throw error;
  await refreshSocial(true);
}

export async function cancelFriendRequest(userId) {
  const { error } = await supabase.from("connection_requests").delete()
    .eq("from_id", sync.user.id).eq("to_id", userId);
  if (error) throw error;
  await refreshSocial(true);
}

/** Ends the friendship. Their account and workouts are untouched. */
export async function removeFriend(userId) {
  const [a, b] = [sync.user.id, userId].sort();
  const { error } = await supabase.from("connections").delete().eq("user_a", a).eq("user_b", b);
  if (error) throw error;
  await refreshSocial(true);
}

/* =========================================================================
   Gyms as places
   gyms is one shared directory: everyone who trains at the same place
   points at the same row. The numbers about a gym come from two database
   functions that return counts only (supabase/008_gym_places.sql).
   ========================================================================= */

/**
 * Puts a gym from the shared directory on your own list (to check in there,
 * or make it "my gym"). It already exists in the cloud, so it's marked as
 * synced rather than uploaded again.
 */
export function adoptGym(g) {
  const state = sync.getState();
  let mine = state.gyms.find((x) => x.id === g.id);
  if (mine) return mine;
  mine = { id: g.id, name: g.name, street: g.street || "", city: g.city || "", state: g.state || "", offerings: [] };
  if (hasPin(g)) { mine.lat = g.lat; mine.lng = g.lng; }
  if (g.private) mine.private = true;
  state.gyms.push(mine);
  if (sync.user && isUuid(g.id)) {
    const meta = loadMeta();
    meta.gyms[g.id] = gymPrint(mine);
    saveMeta(meta);
  }
  return mine;
}

/**
 * Every gym you may see, with how busy each is. Before 008 has been run
 * this falls back to the plain list: the same gyms, without the counts
 * (people, sessions and total come back null).
 */
export async function fetchGymDirectory() {
  if (!sync.user) return null;
  let counted = true;
  let { data, error } = await supabase.rpc("gym_directory");
  if (error) {
    if (!missingFunction(error)) throw error;
    counted = false;
    const all = await supabase.from("gyms").select("*").order("name").limit(2000);
    if (all.error) throw all.error;
    data = all.data;
  }
  return (data || []).map((r) => ({
    id: r.id, name: r.name, street: r.street || "", city: r.city || "", state: r.state || "",
    lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
    private: Boolean(r.is_private),
    people: counted ? r.people_30d : null,
    sessions: counted ? r.sessions_30d : null,
    total: counted ? r.sessions_all : null,
  }));
}

/** Totals for one gym, or null when they aren't available (signed out, or 008 not run). */
export async function fetchGymStats(gymId) {
  if (!sync.user || !isUuid(gymId)) return null;
  let tz = "UTC";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { /* UTC it is */ }
  const { data, error } = await supabase.rpc("gym_stats", { p_gym: gymId, p_tz: tz });
  if (error) {
    if (missingFunction(error)) return null;
    throw error;
  }
  const d = data || {};
  return {
    people: d.people_30d || 0,
    sessions: d.sessions_30d || 0,
    top: Array.isArray(d.top_exercises) ? d.top_exercises : [],
    byHour: Array.isArray(d.by_hour) ? d.by_hour : [],
  };
}

/**
 * Places or moves a pin for a gym that isn't on your own list (yours go up
 * with the normal sync). Resolves true when saved, false when the database
 * can't store pins yet; rejects with the database's reason if it refuses.
 */
export async function saveGymLocation(gymId, lat, lng) {
  if (!sync.user || !isUuid(gymId)) return false;
  const { error } = await supabase.rpc("set_gym_location", { p_gym: gymId, p_lat: lat, p_lng: lng });
  if (!error) return true;
  if (missingFunction(error)) return false;
  throw new Error(error.message || "Couldn't save the pin.");
}

/** Where the map and address lookup come from (app_config), or null to keep the built-in defaults. */
export async function fetchMapConfig() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("app_config").select("value").eq("key", "maps").maybeSingle();
  if (error) {
    if (!missingTable(error)) console.warn("Map settings:", error);
    return null;
  }
  return data ? data.value : null;
}

/* =========================================================================
   Comments, and "at the gym now"  (supabase/009_social.sql)
   ========================================================================= */

/** Posts a comment and returns it as the app stores it: { id, userId, body, at }. */
export async function addComment(workoutId, body) {
  if (!sync.user || !isUuid(workoutId)) throw new Error("Sign in to comment.");
  const text = String(body || "").trim().slice(0, 500);
  if (!text) throw new Error("Write something first.");
  const { data, error } = await supabase.from("comments")
    .insert({ workout_id: workoutId, user_id: sync.user.id, body: text }).select("*").single();
  if (error) {
    if (missingTable(error)) { sync.noComments = true; throw new Error("Comments need a database update (supabase/009_social.sql)."); }
    if (error.code === "42501") throw new Error("Only friends can comment on this workout.");
    throw new Error("Couldn\u2019t post that. Check your connection.");
  }
  return { id: data.id, userId: data.user_id, body: data.body, at: isoOrNull(data.created_at) || new Date().toISOString() };
}

/** Takes down a comment you wrote, or one on your own workout. */
export async function deleteComment(id) {
  if (!sync.user || !isUuid(id)) return;
  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) throw new Error("Couldn\u2019t delete that. Check your connection.");
}

/**
 * Shows friends you're at a gym. The database keeps it for three hours at
 * most. Resolves false when the database can't do this yet (009 not run).
 */
export async function setPresence(gymId) {
  if (!sync.user || !isUuid(gymId)) return false;
  const { error } = await supabase.from("presence")
    .upsert({ user_id: sync.user.id, gym_id: gymId }, { onConflict: "user_id" });
  if (!error) return true;
  if (missingTable(error)) { sync.noPresence = true; return false; }
  throw new Error(error.message || "Couldn\u2019t share where you are.");
}

/** Stops showing you at a gym. Resolves false when the database can't do this yet. */
export async function clearPresence() {
  if (!sync.user || !supabase) return false;
  const { error } = await supabase.from("presence").delete().eq("user_id", sync.user.id);
  if (!error) return true;
  if (missingTable(error)) { sync.noPresence = true; return false; }
  throw new Error(error.message || "Couldn\u2019t clear where you are.");
}

/** One reaction per person per workout; null takes yours off. */
export async function setReaction(workoutId, emoji) {
  if (!sync.user || !isUuid(workoutId)) return;
  const res = emoji
    ? await supabase.from("reactions").upsert(
        { workout_id: workoutId, user_id: sync.user.id, emoji },
        { onConflict: "workout_id,user_id" })
    : await supabase.from("reactions").delete()
        .eq("workout_id", workoutId).eq("user_id", sync.user.id);
  if (res.error) throw res.error;
}

/** Your @handle — how friends find you. */
export async function setUsername(raw) {
  const name = String(raw || "").trim().toLowerCase().replace(/^@/, "");
  if (!USERNAME_RULE.test(name)) {
    throw new Error("Use 3–20 lowercase letters, numbers, _ or .");
  }
  // The rename happens in one database function (supabase/005_change_username.sql):
  // profile and, for username accounts, the login move together. Changing the
  // login through supabase.auth.updateUser fails -- Supabase rejects
  // users.gymsocial.app as an address that can't receive mail.
  const { error } = await supabase.rpc("change_username", { new_name: name });
  if (error) {
    if (error.code === "23505") throw new Error("@" + name + " is taken. Try another.");
    if (error.code === "PGRST202" || /change_username/.test(error.message || "")) {
      throw new Error("Username changes need a quick database update. Run supabase/005_change_username.sql.");
    }
    throw error;
  }
  if (usesUsernameLogin(sync.user)) {
    sync.user.email = loginEmail(name);
    // pick up the new login in this phone's session too
    try { await supabase.auth.refreshSession(); } catch (e) { /* next sign-in will */ }
  }
  const state = sync.getState();
  state.me.handle = name;
  const meRow = (state.users || []).find((u) => u.id === sync.user.id);
  if (meRow) meRow.handle = name;
  persistLocal(state);
  return name;
}

/* =========================================================================
   Push notifications
   iPhone only allows Web Push for apps added to the Home Screen (iOS 16.4+).
   The public key below pairs with VAPID_PRIVATE_KEY in the Edge Function's
   secrets; it is safe to ship.
   ========================================================================= */

const VAPID_PUBLIC_KEY =
  "BE8F9eL7NWqv9sHKOBWwdetyKhe-j_0Iuf-zBSNqGlxO7ZQpE2UJXtwRV5sPe4zy0PKHJ2M-FRfFpORFF5nFr_A";

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
}

/** "ok", "needs-install" (iPhone, opened in Safari) or "unsupported". */
export function pushSupport() {
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  return "ok";
}

/** "granted", "denied" or "default" (never asked). */
export function pushPermission() {
  return "Notification" in window ? Notification.permission : "default";
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** On if this phone is subscribed and allowed. */
export async function pushEnabled() {
  if (pushSupport() !== "ok" || pushPermission() !== "granted") return false;
  return Boolean(await currentSubscription());
}

function keyBytes(base64url) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc("claim_push_subscription", {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
  });
  if (error) throw error;
}

/**
 * Turns notifications on: asks permission (must run straight from a tap),
 * subscribes this phone, and records it against your account.
 */
export async function enablePush() {
  if (!sync.user) throw new Error("Sign in first.");
  if (pushSupport() === "needs-install") throw new Error("needs-install");
  if (pushSupport() !== "ok") throw new Error("This browser can't receive notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "denied" : "dismissed");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  await saveSubscription(sub);
}

export async function disablePush() {
  if (pushSupport() !== "ok") return;
  const sub = await currentSubscription();
  if (!sub) return;
  if (sync.user) await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/* After signing in, make sure an existing subscription points at this account. */
async function refreshPushSubscription() {
  try {
    if (pushSupport() !== "ok" || pushPermission() !== "granted") return;
    const sub = await currentSubscription();
    if (sub) await saveSubscription(sub);
  } catch (e) { console.warn("Push subscription:", e); }
}
