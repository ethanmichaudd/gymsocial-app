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

// The anon key is public by design: Row Level Security in schema.sql is what
// keeps one account out of another's data. .env can override both.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://kmhndltnnlhovykfffjg.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttaG5kbHRubmxob3Z5a2ZmZmpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwMjAxMzEsImV4cCI6MjEwOTU5NjEzMX0.lP0VZq6ZHBpFsnvu_iDNWB-62hYPDuK_osl5D9pTuoQ";

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

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

/** Returns true when the account still needs its email confirmed. */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
  });
  if (error) throw error;
  return !data.session;
}

/**
 * Signing out forgets this device's copy, so the next person to sign in on
 * it doesn't inherit your workouts. Everything synced is safe in the cloud.
 */
export async function signOut(storageKey) {
  await supabase.auth.signOut();
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
    if (sync.user.id !== before) setTimeout(() => syncNow(), 0);
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
  return JSON.stringify([
    w.gymId || null, w.title || null, w.performedAt, w.endedAt || null, w.calories ?? null,
    w.photoPath || null, Boolean(w.photoData),
    w.exercises.map((b) => [
      b.exerciseId, b.metric || "reps", b.equipment || null, b.note || null, b.superset || null,
      b.sets.map((s) => [s.reps ?? null, s.seconds ?? null, s.weight ?? null, s.distance ?? null,
                         s.unit || "lb", s.distUnit || "mi"]),
    ]),
  ]);
}

const gymPrint = (g) => JSON.stringify([g.name, g.street || "", g.city || "", g.state || ""]);
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

/* =========================================================================
   Push: this device -> cloud
   ========================================================================= */

async function pushAll() {
  const state = sync.getState();
  const uid = sync.user.id;
  const meta = loadMeta();

  adoptIntoAccount(state);

  // ---- profile ----
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
      const ins = await supabase.from("gyms").insert({ id: g.id, created_by: uid, ...row });
      if (ins.error) throw ins.error;
    } else {
      // editing only sticks on gyms you added; RLS quietly skips the rest
      const up = await supabase.from("gyms").update(row).eq("id", g.id);
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
  persistLocal(state);
}

async function pushWorkout(w) {
  const up = await supabase.from("workouts").upsert({
    id: w.id, user_id: sync.user.id, gym_id: w.gymId || null, title: w.title || null,
    performed_at: w.performedAt, ended_at: w.endedAt || null, calories: w.calories ?? null,
    photo_path: w.photoPath || null,
  });
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

  const sets = [];
  w.exercises.forEach((b, i) => b.sets.forEach((s, n) => sets.push({
    workout_exercise_id: blocks[i].id, set_number: n + 1,
    reps: s.reps ?? null, seconds: s.seconds ?? null, weight: s.weight ?? null,
    weight_unit: s.unit || "lb", distance: s.distance ?? null, distance_unit: s.distUnit || "mi",
  })));
  if (sets.length) {
    const insS = await supabase.from("workout_sets").insert(sets);
    if (insS.error) throw insS.error;
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
    const p = prof.data;
    const me = state.me;
    if (p.display_name) me.name = p.display_name;
    me.handle = p.username;
    me.isPrivate = p.is_private;
    me.avatar = p.avatar || null;
    Object.assign(state.settings, p.settings || {}, {
      weeklyGoal: p.weekly_goal, streakMode: p.streak_mode,
      customCount: p.custom_count, customDays: p.custom_days,
    });
    const meRow = (state.users || []).find((u) => u.id === uid);
    if (meRow) Object.assign(meRow, { name: me.name, handle: me.handle, isPrivate: me.isPrivate, avatar: me.avatar });
    meta.profile = JSON.stringify(profileRow(state));
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
  const gq = supabase.from("gyms").select("*");
  const gy = await (gymIds.length
    ? gq.or(`created_by.eq.${uid},id.in.(${gymIds.join(",")})`)
    : gq.eq("created_by", uid));
  if (gy.error) throw gy.error;
  gy.data.forEach((r) => {
    const g = { id: r.id, name: r.name, street: r.street || "", city: r.city || "", state: r.state || "" };
    const local = state.gyms.find((x) => x.id === r.id);
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

  await refreshPhotoUrls(state);

  saveMeta(meta);
  persistLocal(state);
  if (changed || wk.data.length) sync.onChange && sync.onChange();
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
  return {
    id: p.id,
    name: p.display_name || p.username,
    handle: p.username,
    avatar: p.avatar || null,
    isPrivate: Boolean(p.is_private),
  };
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

/** Friends, requests, friends' workouts and every reaction on screen. */
async function pullSocial() {
  const state = sync.getState();
  const uid = sync.user.id;
  purgeDemo(state);

  const [conns, reqs] = await Promise.all([
    supabase.from("connections").select("user_a,user_b").or(`user_a.eq.${uid},user_b.eq.${uid}`),
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
    ? await selectIn("profiles", "id,username,display_name,avatar,is_private", "id", people)
    : [];
  const meRow = (state.users || []).find((u) => u.id === uid) ||
    { id: uid, name: state.me.name, handle: state.me.handle, avatar: state.me.avatar, isPrivate: state.me.isPrivate };
  state.users = [meRow].concat(profiles.map(userFromProfile));
  state.follows = friendIds.map((f) => [uid, f]);
  state.connections = friendIds.map((f) => [uid, f]);
  state.friendRequests = { incoming, outgoing };

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

  // ---- the gyms and exercise names their workouts mention ----
  // Kept apart from yours so they never show up in your own pickers.
  const myGyms = new Set(state.gyms.map((g) => g.id));
  const gymIds = [...new Set(theirs.map((w) => w.gymId).filter((id) => id && !myGyms.has(id)))];
  state.foreignGyms = gymIds.length
    ? (await selectIn("gyms", "id,name,street,city,state", "id", gymIds))
        .map((r) => ({ id: r.id, name: r.name, street: r.street || "", city: r.city || "", state: r.state || "" }))
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
    ? await selectIn("reactions", "workout_id,user_id,emoji", "workout_id", wkIds)
    : [];
  const byWorkout = {};
  reacts.forEach((r) => {
    const all = (byWorkout[r.workout_id] = byWorkout[r.workout_id] || {});
    (all[r.emoji] = all[r.emoji] || []).push(r.user_id);
  });
  state.workouts.forEach((w) => { w.reactions = byWorkout[w.id] || {}; });

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
  const { error } = await supabase.from("profiles").update({ username: name }).eq("id", sync.user.id);
  if (error) {
    if (error.code === "23505") throw new Error("@" + name + " is taken. Try another.");
    throw error;
  }
  const state = sync.getState();
  state.me.handle = name;
  const meRow = (state.users || []).find((u) => u.id === sync.user.id);
  if (meRow) meRow.handle = name;
  persistLocal(state);
  return name;
}
