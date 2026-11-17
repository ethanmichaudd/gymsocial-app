/**
 * Shared foundations: the app's state and how it is saved, the queries and
 * formatting every screen uses, streaks, the confirm dialog, the reusable
 * sheet, tabs, theme and keyboard handling.
 */

import { cloudEnabled, currentUser, loadState, newId, refreshSocial, saveState } from "./store.js";
import {
  activityProfile, cardioIconFor, cardioRate, cardioSummary, isCardioWorkout
} from "./cardio.js";
import {
  authResolved, knownPeople, openWorkoutDetail, processPendingAdd, renderFriends,
  setPendingAdd
} from "./feed.js";
import { gymDirectory, renderPlaces } from "./gyms.js";
import { openRecap, renderHome } from "./home.js";
import { openInbox, renderBell } from "./inbox.js";
import { renderLog } from "./log.js";
import { renderProfile } from "./profile.js";
import { renderProgress } from "./progress.js";
import { renderSettings } from "./settings.js";

/* New key: a clean break from the demo data. Nothing from the seeded
   preview carries over. */
export var STORAGE_KEY = "gymsocial_v1";

/* ----------------------------- starting state ----------------------------- */

/* Real uuids, so anything made here can go straight into the database.
   (The prefix is kept for readability at the call sites only.) */
export function uid(prefix) { return newId(); }

/* The weight unit new sets and goals start in (Settings -> Weight in).
   Any single set can still be switched; this is only the starting point. */
export function defaultUnit() {
  return state && state.settings && state.settings.unit === "kg" ? "kg" : "lb";
}

/* Movement pattern per exercise -- drives the calendar colors. */
/* How a set is measured. An exercise picks one; every screen that reads
   sets asks here rather than assuming reps-and-weight. */
export var METRICS = {
  reps:     { label: "Reps",     col1: "Reps",  col2: "Weight",   unitKey: "unit",     units: ["lb", "kg"] },
  time:     { label: "Time",     col1: "Time",  col2: "Weight",   unitKey: "unit",     units: ["lb", "kg"] },
  distance: { label: "Distance", col1: "Time",  col2: "Distance", unitKey: "distUnit", units: ["mi", "km"] },
  // a run, a ride, a row: one entry with its own fields (see CARDIO below)
  cardio:   { label: "Cardio",   col1: "Time",  col2: "Distance", unitKey: "distUnit", units: ["mi", "km", "m"] }
};

export function pad2(n) { return (n < 10 ? "0" : "") + n; }

// a cardio post reads "🏃 Run" in lists
export function workoutTitleHtml(wk) {
  var t = esc(wk.title || "Workout");
  return isCardioWorkout(wk) ? '<span class="cardio-icon">' + cardioIconFor(wk) + '</span> ' + t : t;
}

/* What the movement was loaded with. Chosen per exercise in a session, so
   "Bench, dumbbell" and "Bench, barbell" stay distinguishable without being
   two separate catalogue entries. Bodyweight drops the weight box. */
/* Deliberately short: these five cover most of what gets logged, and a
   built-in cannot be deleted -- only hidden. Anything else you add yourself
   from the rail, and that one you can delete. */
var BUILTIN_EQUIPMENT = ["Bodyweight", "Dumbbell", "Barbell", "Cable", "Machine", "No weight"];

export function equipmentList(includeHidden) {
  var st = state.settings || {};
  var all = BUILTIN_EQUIPMENT.concat(st.customEquipment || []);
  if (includeHidden) return all;
  var off = st.hiddenEquipment || [];
  return all.filter(function (e) { return off.indexOf(e) === -1; });
}

/* Anything typed in gets its words capitalised -- "machine incline" files
   as "Machine Incline". A word that already has a capital in it is left
   alone, so "EZ bar" does not come back as "Ez Bar". */
export function titleCase(s) {
  return String(s || "").trim().replace(/\s+/g, " ").split(" ").map(function (w) {
    return w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }).join(" ");
}

/* The same number means different things on different equipment. The mode
   decides what the weight column is called and how a set reads back. */
var WEIGHT_MODES = {
  total:   { label: "Weight",       suffix: "" },
  perSide: { label: "Per side",     suffix: "/side" },
  perHand: { label: "Per hand",     suffix: " each" },
  added:   { label: "Weight",       suffix: "" },
  none:    { label: "",             suffix: "" }   // no weight box at all
};

var DEFAULT_WEIGHT_MODE = {
  "Bodyweight": "added",
  "Dumbbell": "perHand",
  "Barbell": "total",
  "Cable": "total",
  "Machine": "total",
  "No weight": "none"
};

function weightMode(equipment) {
  if (!equipment) return "total";
  var set = (state.settings && state.settings.equipmentModes) || {};
  return WEIGHT_MODES[set[equipment]] ? set[equipment]
    : (DEFAULT_WEIGHT_MODE[equipment] || "total");
}

export function weightLabel(blk) {
  return WEIGHT_MODES[weightMode(blk && blk.equipment)].label;
}

export function isCustomEquipment(name) {
  return BUILTIN_EQUIPMENT.indexOf(name) === -1;
}

/* Reps and holds are loaded with something -- a weighted plank is the whole
   reason Time needs it too. A run is not, so Distance still has no rail. */
export function usesEquipment(metric) { return metric !== "distance"; }

/* Only "No weight" drops the column. Bodyweight keeps it (empty unless you
   hung a plate off yourself); a run never had one. */
export function dropsWeight(blk, metric) {
  return metric !== "distance" && !!blk && weightMode(blk.equipment) === "none";
}

/* Per hand and per side are half the load: 50s in each hand moved 100. */
function loadMultiplier(equipment) {
  var m = weightMode(equipment);
  return m === "perHand" || m === "perSide" ? 2 : 1;
}

/* Exercises that are obviously not rep-and-weight start in the right mode. */
export var DEFAULT_METRIC = {
  "Plank": "time",
  "Treadmill Run": "distance",
  "Stationary Bike": "distance"
};

export function metricOf(blk) {
  if (blk && blk.metric && METRICS[blk.metric]) return blk.metric;
  var exObj = blk ? findExercise(blk.exerciseId) : null;
  if (exObj && exObj.metric && METRICS[exObj.metric]) return exObj.metric;
  return "reps";
}

export function formatDuration(sec) {
  if (sec == null) return "";
  if (sec < 60) return sec + "s";
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
}

/* Seconds -> the three boxes. Zero parts show as blank so the placeholders
   stay readable. */
export function splitDuration(sec) {
  if (sec == null) return { h: "", m: "", s: "" };
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return { h: h || "", m: m || "", s: s || "" };
}

export function joinDuration(h, m, s) {
  var total = (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
  return total > 0 ? total : null;
}

export function usesDuration(metric) { return metric === "time" || metric === "distance" || metric === "cardio"; }

/* The number a set is judged by, in its own mode. */
function setValue(s, metric) {
  if (metric === "cardio") return s.distance != null ? s.distance : s.seconds;
  if (metric === "distance") return s.distance;
  if (metric === "time") return s.seconds;
  return s.weight;
}

export function bestValueIn(sets, metric) {
  var best = null;
  sets.forEach(function (s) {
    var v = setValue(s, metric);
    if (v == null) return;
    if (best === null || v > best) best = v;
  });
  return best;
}

export function unitFor(sets, metric) {
  if (metric === "cardio") {
    var d = sets.filter(function (s) { return s.distance != null; })[0];
    return d ? (d.distUnit || "mi") : "";
  }
  var key = METRICS[metric].unitKey;
  var withUnit = sets.filter(function (s) { return s[key]; })[0];
  return withUnit ? withUnit[key] : METRICS[metric].units[0];
}

export function formatValue(v, metric, unit) {
  if (v == null) return "";
  if (metric === "cardio") return unit ? (Math.round(v * 100) / 100) + " " + unit : formatDuration(v);
  if (metric === "time") return formatDuration(v);
  if (metric === "distance") return v + " " + unit;
  return v + unit;
}

/* Seeded demo accounts that start private. */
var DEMO_PRIVATE_HANDLES = { pnair: true };

/* Bump when saved data needs actively repairing, not just back-filling. */
var SCHEMA_VERSION = 5;

/* A stand-in friend so the Friends section can be seen before accounts
   exist. Settings can remove it, and real accounts replace it. */
var DEMO_FRIEND_ID = "demo_friend";
var DEMO_FRIEND_2_ID = "demo_friend_2";

/* No equipment in the names: that's picked on the rail, and each one
   starts on what it's usually done with until you've logged it yourself. */
var SEED_EXERCISE_NAMES = [
  "Bench Press", "Incline Press", "Back Squat", "Deadlift",
  "Romanian Deadlift", "Overhead Press", "Pull-Up", "Bent-Over Row",
  "Bicep Curl", "Tricep Pushdown", "Lateral Raise", "Lat Pulldown",
  "Leg Press", "Plank"
];

export var DEFAULT_EQUIPMENT = {
  "Bench Press": "Barbell", "Incline Press": "Dumbbell", "Back Squat": "Barbell",
  "Deadlift": "Barbell", "Romanian Deadlift": "Barbell", "Overhead Press": "Barbell",
  "Pull-Up": "Bodyweight", "Bent-Over Row": "Barbell", "Bicep Curl": "Dumbbell",
  "Tricep Pushdown": "Cable", "Lateral Raise": "Dumbbell", "Lat Pulldown": "Cable",
  "Leg Press": "Machine", "Plank": "Bodyweight"
};

export var EXERCISE_CATEGORIES = {
  "Bench Press": "push", "Incline Press": "push", "Bent-Over Row": "pull",
  "Barbell Bench Press": "push", "Incline Dumbbell Press": "push", "Overhead Press": "push",
  "Lateral Raise": "push", "Tricep Pushdown": "push",
  "Pull-Up": "pull", "Lat Pulldown": "pull", "Barbell Row": "pull", "Bicep Curl": "pull",
  "Back Squat": "legs", "Deadlift": "legs", "Romanian Deadlift": "legs", "Leg Press": "legs",
  "Plank": "core",
  "Treadmill Run": "cardio", "Stationary Bike": "cardio"
};


/* A clean starting state: just you and the standard exercise catalog.
   No sample people, gyms, or sessions -- everything from here is yours. */
export function seedState() {
  var exercises = SEED_EXERCISE_NAMES.map(function (name) {
    return {
      id: uid("ex"), name: name,
      category: EXERCISE_CATEGORIES[name] || "other",
      metric: DEFAULT_METRIC[name] || "reps"
    };
  });

  var me = { id: "me", name: "You", handle: "you", isPrivate: false };

  var fresh = {
    me: me,
    users: [me],
    connections: [],
    follows: [],
    connectionRequests: [],
    exercises: exercises,
    gyms: [],
    workouts: [],
    settings: {
      weeklyGoal: 3, streakMode: "weekly", customCount: 4, customDays: 10,
      customEquipment: [], hiddenEquipment: [], equipmentModes: {}, theme: "light",
      schemaVersion: SCHEMA_VERSION
    }
  };
  // the stand-ins only ever existed for the signed-out preview; a signed-in
  // account has real friends (sync clears any left over from before)
  if (!currentUser()) {
    addDemoFriend(fresh);
    addDemoFriend2(fresh);
  }
  return fresh;
}

/* ----------------------------- state / persistence ----------------------------- */

export var state;
export function setState(v) { state = v; return v; }

function load() {
  var saved = loadState(STORAGE_KEY);
  var s = saved ? migrate(saved) : seedState();
  refreshDemoDates(s);
  return s;
}

/* Fills in fields added after a version was saved, so an upgrade never
   wipes what someone already logged. */
export function migrate(s) {
  if (!s.settings) s.settings = {};
  if (s.settings.weeklyGoal == null) s.settings.weeklyGoal = 3;
  if (!s.settings.streakMode) s.settings.streakMode = "weekly";
  if (s.settings.customCount == null) s.settings.customCount = 4;
  if (s.settings.customDays == null) s.settings.customDays = 10;
  if (!s.settings.customEquipment) s.settings.customEquipment = [];
  if (!s.settings.hiddenEquipment) s.settings.hiddenEquipment = [];
  if (!s.settings.equipmentModes) s.settings.equipmentModes = {};
  if (!s.settings.theme) s.settings.theme = "light";
  (s.gyms || []).forEach(function (g) {
    if (g.street == null) g.street = "";
    if (g.city == null) g.city = "";
    if (g.state == null) g.state = "";
  });
  (s.exercises || []).forEach(function (e) {
    if (!e.category) e.category = EXERCISE_CATEGORIES[e.name] || "other";
    if (!e.metric) e.metric = DEFAULT_METRIC[e.name] || "reps";
  });
  if (s.me && s.me.isPrivate == null) s.me.isPrivate = false;
  (s.users || []).forEach(function (u) {
    if (u.isPrivate == null) u.isPrivate = !!DEMO_PRIVATE_HANDLES[u.handle];
  });

  // An earlier build back-filled every seeded account as public and saved
  // that, so the wrong value is already on disk -- back-filling can't undo
  // it. Repair the demo characters once. Your own choice is never touched.
  if ((s.settings.schemaVersion || 1) < 2) {
    (s.users || []).forEach(function (u) {
      if (s.me && u.id === s.me.id) return;
      u.isPrivate = !!DEMO_PRIVATE_HANDLES[u.handle];
    });
    s.settings.schemaVersion = 2;
  }

  // v3 split one mutual relationship into follows + connections. Anyone you
  // were already connected to becomes someone you follow, so feeds survive.
  if (!s.follows) {
    s.follows = [];
    (s.connections || []).forEach(function (p) {
      s.follows.push([p[0], p[1]]);
      s.follows.push([p[1], p[0]]);
    });
  }
  if (!s.connectionRequests) s.connectionRequests = [];
  if ((s.settings.schemaVersion || 1) < 4) {
    addDemoFriend(s);
    s.settings.schemaVersion = 4;
  }
  if ((s.settings.schemaVersion || 1) < 5) {
    if ((s.users || []).some(function (u) { return u.id === DEMO_FRIEND_ID; })) addDemoFriend2(s);
    s.settings.schemaVersion = 5;
  }
  (s.workouts || []).forEach(function (w) { if (!w.reactions) w.reactions = {}; });
  s.settings.schemaVersion = SCHEMA_VERSION;
  // state.me and its row in state.users are the same object in a fresh seed
  // but separate objects after a JSON round-trip -- resync them.
  var meRow = (s.users || []).filter(function (u) { return s.me && u.id === s.me.id; })[0];
  if (meRow && s.me) meRow.isPrivate = s.me.isPrivate;
  return s;
}

/* Builds today's session for the stand-in friend. Dated at run time so it
   is always "today" whenever the app is first opened after the update. */
function addDemoFriend(s) {
  if ((s.users || []).some(function (u) { return u.id === DEMO_FRIEND_ID; })) return;

  var byName = {};
  (s.exercises || []).forEach(function (e) { byName[e.name] = e.id; });
  var plan = [
    ["Bench Press", "Barbell", [[8, 165], [8, 175], [6, 185]]],
    ["Incline Press", "Dumbbell", [[10, 60], [10, 60], [8, 65]]],
    ["Lateral Raise", "Dumbbell", [[15, 20], [15, 20], [12, 25]]],
    ["Tricep Pushdown", "Cable", [[12, 50], [12, 55], [10, 60]]]
  ].filter(function (row) { return byName[row[0]]; });
  if (!plan.length) return;

  var start = new Date();
  start.setHours(7, 15, 0, 0);
  var end = new Date(start.getTime() + 58 * 60 * 1000);

  s.users = s.users || [];
  s.users.push({ id: DEMO_FRIEND_ID, name: "Maya Jensen", handle: "mayaj", isPrivate: false });
  s.follows = s.follows || [];
  s.follows.push([s.me.id, DEMO_FRIEND_ID]);

  s.workouts = s.workouts || [];
  s.workouts.push({
    id: "demo_wk_1",
    userId: DEMO_FRIEND_ID,
    userName: "Maya Jensen",
    gymId: null,
    title: "Push Day",
    performedAt: start.toISOString(),
    endedAt: end.toISOString(),
    calories: 430,
    exercises: plan.map(function (row) {
      return {
        exerciseId: byName[row[0]],
        metric: "reps",
        equipment: row[1],
        sets: row[2].map(function (st) {
          return { reps: st[0], seconds: null, weight: st[1], distance: null,
                   unit: "lb", distUnit: "mi" };
        })
      };
    })
  });
}

/* ---- comments and tags: only where the database has them ----
   Both arrive with supabase/009_social.sql. Until the first sync says
   otherwise they're assumed to be there; after it, a database without
   them simply doesn't show the controls. */
export function featureOn(name) {
  return !!currentUser() && (state.features || {})[name] !== false;
}

export function workoutById(id) {
  return state.workouts.filter(function (w) { return w.id === id; })[0];
}

/* The stand-ins are scenery, not history. Their sessions are re-dated to
   today and yesterday on every load, so the Friends page never looks broken
   just because a few days passed. Real friends are never touched. */
function refreshDemoDates(s) {
  // declared in here on purpose: load() runs before a var at this point in
  // the file would have been assigned, and reading it would throw
  var daysBack = { demo_wk_1: 0, demo_wk_2: 1 };
  (s.workouts || []).forEach(function (w) {
    if (!(w.id in daysBack)) return;
    var was = new Date(w.performedAt);
    var want = new Date();
    want.setDate(want.getDate() - daysBack[w.id]);
    want.setHours(was.getHours(), was.getMinutes(), 0, 0);
    var ran = w.endedAt ? new Date(w.endedAt) - was : 0;
    w.performedAt = want.toISOString();
    if (w.endedAt) w.endedAt = new Date(want.getTime() + ran).toISOString();
  });
}

function addDemoFriend2(s) {
  if ((s.users || []).some(function (u) { return u.id === DEMO_FRIEND_2_ID; })) return;

  var byName = {};
  (s.exercises || []).forEach(function (e) { byName[e.name] = e.id; });
  var plan = [
    ["Back Squat", "Barbell", [[5, 225], [5, 245], [3, 265]]],
    ["Romanian Deadlift", "Barbell", [[8, 185], [8, 195]]],
    ["Leg Press", "Machine", [[12, 320], [12, 360]]]
  ].filter(function (row) { return byName[row[0]]; });
  if (!plan.length) return;

  var start = new Date();
  start.setDate(start.getDate() - 1);
  start.setHours(18, 5, 0, 0);
  var end = new Date(start.getTime() + 72 * 60 * 1000);

  s.users.push({ id: DEMO_FRIEND_2_ID, name: "Dev Patel", handle: "devp", isPrivate: false });
  s.follows = s.follows || [];
  s.follows.push([s.me.id, DEMO_FRIEND_2_ID]);
  s.workouts.push({
    id: "demo_wk_2",
    userId: DEMO_FRIEND_2_ID,
    userName: "Dev Patel",
    gymId: null,
    title: "Leg Day",
    performedAt: start.toISOString(),
    endedAt: end.toISOString(),
    calories: 520,
    reactions: {},
    exercises: plan.map(function (row) {
      return {
        exerciseId: byName[row[0]],
        metric: "reps",
        equipment: row[1],
        sets: row[2].map(function (st) {
          return { reps: st[0], seconds: null, weight: st[1], distance: null,
                   unit: "lb", distUnit: "mi" };
        })
      };
    })
  });

  // so the counts on the reaction bar are not all zero to begin with
  var maya = s.workouts.filter(function (w) { return w.id === "demo_wk_1"; })[0];
  if (maya) maya.reactions = { "\uD83D\uDD25": [DEMO_FRIEND_2_ID] };
}

export function persist() {
  saveState(STORAGE_KEY, state);
}

/* Your catalogue first; then names pulled in for friends' workouts, which
   are kept apart so they never appear in your own pickers. */
export function findExercise(id) {
  var byId = function (e) { return e.id === id; };
  return state.exercises.filter(byId)[0] || (state.foreignExercises || []).filter(byId)[0];
}
export function findGym(id) {
  var byId = function (g) { return g.id === id; };
  return state.gyms.filter(byId)[0] || (state.foreignGyms || []).filter(byId)[0] ||
    gymDirectory().filter(byId)[0];
}

/* Two ways to say the same gym: the short label that goes everywhere a gym
   is named, and the full address for the screens that have room for it. */
function gymPlace(g) {
  return [g.city, g.state].filter(Boolean).join(", ");
}

function gymBaseLabel(g) {
  var place = gymPlace(g);
  return place ? g.name + " - " + place : g.name;
}

/* "100 Liberty St" -> "Liberty St". The number is what you need to walk
   there; the street is what you need to tell two of them apart. */
function streetShort(street) {
  return String(street || "").replace(/^\s*[\d-]+\s*/, "").trim() || String(street || "");
}

/* Two Planet Fitnesses in Boston read identically everywhere, so when a
   name and city are shared the street gets appended -- and only then, so
   the usual case stays short. */
export function gymLabel(g) {
  if (!g) return "";
  var base = gymBaseLabel(g);
  if (!g.street) return base;
  var shared = state.gyms.some(function (x) {
    return x.id !== g.id && gymBaseLabel(x).toLowerCase() === base.toLowerCase();
  });
  return shared ? base + " (" + streetShort(g.street) + ")" : base;
}

/* What makes a gym the same gym -- used for the duplicate check, since the
   label above deliberately differs between two gyms at different streets. */
export function gymKey(g) {
  return [g.name, g.street, g.city, g.state]
    .map(function (v) { return String(v || "").trim().toLowerCase(); }).join("|");
}

export function gymAddress(g) {
  if (!g) return "";
  return [g.street, gymPlace(g)].filter(Boolean).join(", ");
}
export function findUser(id) { return state.users.filter(function (u) { return u.id === id; })[0]; }

/* Anyone we have a name for: friends first, then people who turned up in
   the Inbox or a search without being friends. */
export function findPerson(id) {
  return findUser(id) ||
    (state.inboxPeople || []).filter(function (u) { return u.id === id; })[0] ||
    knownPeople[id];
}

/* ----------------------------- your data ----------------------------- */

/* Personal app: every query is scoped to you. The multi-user helpers that
   used to live here come back with the social layer. */
export function workoutsOf(userId) {
  return state.workouts.filter(function (w) { return w.userId === userId; });
}

export function myWorkouts() { return workoutsOf(state.me.id); }

/* One-way: whose sessions reach your home screen. Mutual connections, which
   are what unlock a private log, arrive with real accounts. */
/* Signed out, there is nobody to show: friends are accounts. */
export function signedOut() { return cloudEnabled() && !currentUser(); }

export function friendsOf(userId) {
  if (signedOut()) return [];
  return (state.follows || [])
    .filter(function (f) { return f[0] === userId; })
    .map(function (f) { return findUser(f[1]); })
    .filter(Boolean);
}

/* A photo if there is one, initials if not -- same box either way, so
   every list that shows people lines up. */
export function avatarHtml(user, extra) {
  var cls = "avatar" + (extra ? " " + extra : "");
  if (user && user.avatar) {
    return '<span class="' + cls + ' has-photo" style="background-image:url(' +
      esc(user.avatar) + ')"></span>';
  }
  return '<span class="' + cls + '">' + esc(initialsOf(user ? user.name : "?")) + '</span>';
}

function initialsOf(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2)
    .map(function (w) { return w.charAt(0).toUpperCase(); }).join("");
}

/* ---- what you did last time, so logging is a target not a blank form ---- */

/* The most recent session containing this exercise, ignoring the one being
   edited so it never compares a workout against itself. */
/* ---- exercise names, compared loosely ----
   Case, plurals, "biceps"/"bicep" and "Bench"/"Bench Press" don't matter. */
export function singularWord(w) {
  var l = w.toLowerCase();
  if (/(ss|us|is)$/.test(l)) return w;                    // press, biceps -> leave
  if (/(sh|ch|ss)es$/.test(l)) return w.slice(0, -2);     // pushes -> push
  if (/ies$/.test(l) && l.length > 4) return w.slice(0, -3) + "y";   // flies -> fly
  if (/[^s]s$/.test(l) && l.length > 3) return w.slice(0, -1);       // curls -> curl
  return w;
}

export function exerciseKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter(Boolean).map(function (w) { return singularWord(w.replace(/s$/, "")); }).join(" ")
    .replace(/\bbench pre\b/g, "bench");   // "press" comes out as "pre"
}

/* Every id that is really this exercise: the same name can exist twice
   (made on two phones before they synced, or an older spelling). */
function sameExerciseIds(exerciseId) {
  var ex = findExercise(exerciseId);
  if (!ex || ex.metric === "cardio") return [exerciseId];
  var key = exerciseKey(ex.name);
  var ids = state.exercises.filter(function (e) {
    return e.metric !== "cardio" && exerciseKey(e.name) === key;
  }).map(function (e) { return e.id; });
  if (ids.indexOf(exerciseId) === -1) ids.push(exerciseId);
  return ids;
}

/* The most recent time you did this exercise. With equipment, only on that
   equipment; sessions saved before equipment was recorded count for any. */
export function lastSessionFor(exerciseId, excludeWorkoutId, equipment) {
  var ids = sameExerciseIds(exerciseId);
  var pick = function (match) {
    var found = null;
    myWorkouts().forEach(function (wk) {
      if (excludeWorkoutId && wk.id === excludeWorkoutId) return;
      var blk = wk.exercises.filter(function (we) {
        return ids.indexOf(we.exerciseId) !== -1 && match(we.equipment || null);
      })[0];
      if (!blk) return;
      if (!found || new Date(wk.performedAt) > new Date(found.workout.performedAt)) {
        found = { workout: wk, block: blk };
      }
    });
    return found;
  };
  if (equipment === undefined) return pick(function () { return true; });
  var want = equipment || null;
  return pick(function (eq) { return eq === want; }) ||
    (want ? pick(function (eq) { return eq === null; }) : null);
}

/* "3x8 @ 135lb", "3x45s", "2.0 mi in 18:30" -- collapses identical sets. */
export function summarizeSets(sets, metric, equipment, name) {
  metric = metric || "reps";
  if (metric === "cardio") return cardioSummary(sets[0], name, true);
  var cfg = METRICS[metric], unitKey = cfg.unitKey;
  var wSuffix = metric === "distance" ? ""
    : WEIGHT_MODES[weightMode(equipment)].suffix;
  var parts = [], run = null;
  sets.forEach(function (s) {
    var sig = [s.reps, s.seconds, s.weight, s.distance, s[unitKey], s.drop ? "drop" : ""].join("|");
    if (run && run.sig === sig) { run.n++; return; }
    run = { n: 1, sig: sig, s: s };
    parts.push(run);
  });
  return parts.map(function (p) {
    var s = p.s, unit = s[unitKey] || cfg.units[0], mult = p.n > 1 ? p.n + "×" : "";
    if (metric === "distance") {
      var d = s.distance != null ? s.distance + " " + unit : "";
      var t = s.seconds != null ? formatDuration(s.seconds) : "";
      return mult + (d && t ? d + " in " + t : d || t || "—");
    }
    if (metric === "time") {
      var hold = s.seconds != null ? formatDuration(s.seconds) : "—";
      return mult + hold + (s.weight != null ? " @ " + s.weight + unit + wSuffix : "");
    }
    var reps = s.reps == null ? "?" : s.reps;
    // a drop set reads "↓ 8 @ 185lb"
    return (s.drop ? "↓ " : "") + mult + reps + (s.weight != null ? " @ " + s.weight + unit + wSuffix : "");
  }).join(", ");
}

/* Total weight moved, kept per unit rather than silently converting. */
export function sessionVolume(exerciseBlocks) {
  var vol = { lb: 0, kg: 0 };
  exerciseBlocks.forEach(function (blk) {
    if (metricOf(blk) !== "reps") return; // only rep work has tonnage
    var mult = loadMultiplier(blk.equipment);
    blk.sets.forEach(function (s) {
      if (s.weight == null || s.reps == null) return;
      vol[s.unit === "kg" ? "kg" : "lb"] += s.weight * s.reps * mult;
    });
  });
  return vol;
}

/* Time recorded on the sets themselves -- a run's 24:00, a plank's holds.
   Distinct from start-to-end clock time, which includes rest. */
export function loggedSetTime(exerciseBlocks) {
  var total = 0;
  exerciseBlocks.forEach(function (blk) {
    if (!usesDuration(metricOf(blk))) return;
    blk.sets.forEach(function (s) { if (s.seconds) total += s.seconds; });
  });
  return total || null;
}

export function sessionDistance(exerciseBlocks) {
  var out = { mi: 0, km: 0 };
  exerciseBlocks.forEach(function (blk) {
    var m = metricOf(blk);
    if (m !== "distance" && m !== "cardio") return;
    blk.sets.forEach(function (s) {
      if (s.distance == null) return;
      if (s.distUnit === "km") out.km += s.distance;
      else if (s.distUnit === "m") out.km += s.distance / 1000;
      else out.mi += s.distance;
    });
  });
  return out;
}


/* A PR means beating your own previous best on that lift, measured the way
   that lift is measured -- heaviest weight, longest hold, furthest distance.
   The first time you log an exercise isn't a PR; that would cheapen it. */
export function detectPRs(exerciseBlocks, excludeWorkoutId, before) {
  var prs = [];
  var cutoff = before ? new Date(before).getTime() : null;
  exerciseBlocks.forEach(function (blk) {
    var metric = metricOf(blk);
    if (metric === "cardio") return;      // a run isn't a lift record
    var now = bestValueIn(blk.sets, metric);
    if (now === null) return;
    var unit = unitFor(blk.sets, metric);

    var prev = null;
    myWorkouts().forEach(function (wk) {
      if (excludeWorkoutId && wk.id === excludeWorkoutId) return;
      if (cutoff !== null && new Date(wk.performedAt).getTime() >= cutoff) return;
      wk.exercises.forEach(function (we) {
        if (we.exerciseId !== blk.exerciseId) return;
        if (metricOf(we) !== metric) return; // only compare like with like
        var b = bestValueIn(we.sets, metric);
        if (b !== null && (prev === null || b > prev)) prev = b;
      });
    });

    if (prev !== null && now > prev) {
      var exObj = findExercise(blk.exerciseId);
      prs.push({
        name: exObj ? exObj.name : "Exercise",
        display: formatValue(now, metric, unit),
        delta: metric === "time"
          ? formatDuration(now - prev)
          : (Math.round((now - prev) * 100) / 100) + (metric === "distance" ? " " + unit : unit)
      });
    }
  });
  return prs;
}

/* The records a workout of yours set on the day it happened: measured
   against everything before it, not against what you've done since. */
export function prsAt(wk) {
  if (!wk || wk.userId !== state.me.id) return [];
  return detectPRs(wk.exercises, wk.id, wk.performedAt);
}

/* Cheap tactility -- ignored on devices that don't support it. */
export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* no-op */ }
}

/* Gyms a person has actually trained at, with how many sessions each. */
export function gymsOf(userId) {
  var counts = {};
  workoutsOf(userId).forEach(function (w) {
    if (w.gymId) counts[w.gymId] = (counts[w.gymId] || 0) + 1;
  });
  return Object.keys(counts).map(function (gid) {
    return { gym: findGym(gid), sessions: counts[gid] };
  }).filter(function (row) { return !!row.gym; })
    .sort(function (a, b) { return b.sessions - a.sessions; });
}

export function localDayKey(iso) {
  var d = new Date(iso);
  return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
}

/* ----------------------------- streaks ----------------------------- */

/* Weeks run Sunday -> Saturday, matching the calendar grid. */
export function weekStartOf(date) {
  var d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function startOfDay(date) { var d = new Date(date); d.setHours(0, 0, 0, 0); return d; }

/* Three ways to count a streak, all sharing one rule: the period you're
   currently inside can't break the streak just because it isn't finished. */
export function computeStreak(userId) {
  var st = state.settings || {};
  var mode = st.streakMode || "weekly";
  var mine = workoutsOf(userId);
  var out = { mode: mode, current: 0, best: 0, inPeriod: 0, goal: 1, days: 0, total: mine.length };

  // The goal is the goal before the first workout too -- it used to fall
  // back to 1 here, so a new log read "0 of 1 this week".
  if (mode === "custom") {
    out.goal = st.customCount || 4;
    out.days = st.customDays || 10;
  } else if (mode === "weekly") {
    out.goal = st.weeklyGoal || 3;
    out.days = 7;
  }

  if (!mine.length) return out;
  if (mode === "daily") return dailyStreak(mine, out);
  if (mode === "custom") return blockStreak(mine, out.goal, out.days, out);
  return weeklyStreak(mine, out.goal, out);
}

/* Consecutive calendar weeks (Sun-Sat) that each hit the target. */
function weeklyStreak(mine, goal, out) {
  var byWeek = {}, earliest = null;
  mine.forEach(function (w) {
    var k = weekStartOf(new Date(w.performedAt)).getTime();
    byWeek[k] = (byWeek[k] || 0) + 1;
    if (earliest === null || k < earliest) earliest = k;
  });

  var thisWeekKey = weekStartOf(new Date()).getTime();
  out.inPeriod = byWeek[thisWeekKey] || 0;

  // Walk week by week with real date math so DST can't shift a boundary.
  var weeks = [], cursor = new Date(earliest);
  while (weekStartOf(cursor).getTime() <= thisWeekKey) {
    weeks.push(byWeek[weekStartOf(cursor).getTime()] || 0);
    cursor.setDate(cursor.getDate() + 7);
  }

  var run = 0;
  weeks.forEach(function (n, i) {
    var inProgress = i === weeks.length - 1;
    if (n >= goal) { run++; if (run > out.best) out.best = run; }
    else if (!inProgress) run = 0;
  });

  var i = weeks.length - 1;
  if (weeks[i] < goal) i--; // this week is still running -- not a miss yet
  while (i >= 0 && weeks[i] >= goal) { out.current++; i--; }
  return out;
}

/* Consecutive days with at least one session. */
function dailyStreak(mine, out) {
  var days = {};
  mine.forEach(function (w) { days[startOfDay(w.performedAt).getTime()] = true; });
  var today = startOfDay(new Date());
  out.goal = 1;
  out.days = 1;
  out.inPeriod = days[today.getTime()] ? 1 : 0;

  var cur = new Date(today);
  if (!days[cur.getTime()]) cur.setDate(cur.getDate() - 1); // today isn't over yet
  while (days[cur.getTime()]) { out.current++; cur.setDate(cur.getDate() - 1); }

  var keys = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
  var run = 0, prev = null;
  keys.forEach(function (t) {
    if (prev === null) { run = 1; }
    else {
      var expected = new Date(prev);
      expected.setDate(expected.getDate() + 1);
      run = expected.getTime() === t ? run + 1 : 1;
    }
    if (run > out.best) out.best = run;
    prev = t;
  });
  return out;
}

/* Consecutive rolling N-day blocks, counted back from today, that each
   contain at least `count` sessions. */
function blockStreak(mine, count, days, out) {
  var today = startOfDay(new Date());
  var buckets = {}, maxIdx = 0;
  mine.forEach(function (w) {
    var diff = Math.round((today - startOfDay(w.performedAt)) / 86400000);
    if (diff < 0) return; // future-dated
    var idx = Math.floor(diff / days);
    buckets[idx] = (buckets[idx] || 0) + 1;
    if (idx > maxIdx) maxIdx = idx;
  });
  out.inPeriod = buckets[0] || 0;

  var i = 0;
  if ((buckets[0] || 0) < count) i = 1; // current block still filling
  while ((buckets[i] || 0) >= count) { out.current++; i++; }

  var run = 0;
  for (var k = maxIdx; k >= 0; k--) {
    var n = buckets[k] || 0;
    if (n >= count) { run++; if (run > out.best) out.best = run; }
    else if (k !== 0) run = 0; // block 0 is in progress, not a miss
  }
  return out;
}

export var FRIENDS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8"/><path d="M17.5 14.2a5.5 5.5 0 0 1 3 4.8"/></svg>';
export var FLAME_SVG = '<svg class="streak-flame" viewBox="0 0 24 24"><path d="M12.5 2c.4 3-1.3 4.6-2.7 6C8.2 9.5 7 11 7 13.4A5.6 5.6 0 0 0 12.6 19a5.4 5.4 0 0 0 5.4-5.5c0-3.4-2.3-5-3.4-7.3-.4.9-1 1.5-1.7 2 .4-2.2-.1-4.6-.4-6.2Z"/></svg>';

export function streakUnit(mode) {
  return mode === "daily" ? "day" : mode === "weekly" ? "week" : "block";
}

/* The streak is a number now -- it lives in the third tile. What a card
   used to say in a sentence, this says in one line and a bar: where you
   are against the goal you set. It stays one line however long you train,
   which a growing list of counters would not. */
export function renderGoalBar(userId) {
  var s = computeStreak(userId);
  var el = document.getElementById("goal-bar");
  var best = s.best > 0
    ? '<span class="goal-best">Best ' + s.best + ' ' + streakUnit(s.mode) +
      (s.best === 1 ? "" : "s") + '</span>'
    : "";

  if (s.mode === "daily") {
    el.innerHTML = '<div class="goal-line"><span>' +
      (s.inPeriod ? "Logged today." : "Nothing logged today yet.") + '</span>' + best + '</div>';
    return;
  }

  var pct = Math.max(0, Math.min(100, Math.round((s.inPeriod / s.goal) * 100)));
  var when = s.mode === "weekly" ? "this week" : "in the last " + s.days + " days";
  el.innerHTML =
    '<div class="goal-line">' +
      '<span><strong class="num">' + s.inPeriod + '</strong> of <strong class="num">' + s.goal +
        '</strong> ' + when + '</span>' + best +
    '</div>' +
    '<div class="goal-track"><div class="goal-fill' + (pct >= 100 ? " is-done" : "") +
      '" style="width:' + pct + '%"></div></div>';
}

/* Tapping a notification opens the app at ?workout=<id> or ?friends=1, or,
   if it was already open, the service worker posts that same URL here.
   ?friends=1 is a friend request, and those are answered in the Inbox. */
export var pendingWorkout = null;
export function setPendingWorkout(v) { pendingWorkout = v; return v; }
export var pendingInbox = false;     // asked for before we knew who's signed in
export function setPendingInbox(v) { pendingInbox = v; return v; }

export function openFromUrl(href) {
  var params = new URL(href, location.href).searchParams;
  var wid = params.get("workout");
  var add = params.get("add");
  if (add) {
    setPendingAdd(String(add).toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, ""));
    if (location.search) history.replaceState(null, "", location.pathname);
    processPendingAdd();
    return;
  }
  if (params.get("friends") || params.get("inbox")) {
    activateTab("friends");
    if (authResolved) openInbox(); else pendingInbox = true;
  } else if (params.get("recap")) {
    activateTab("home");
    openRecap();
  } else if (wid) {
    activateTab("friends");
    if (state.workouts.some(function (w) { return w.id === wid; })) openWorkoutDetail(wid);
    else { pendingWorkout = wid; refreshSocial(true); }   // a friend's, not here yet
  }
  if (location.search) history.replaceState(null, "", location.pathname);
}

/* ----------------------------- are you sure ----------------------------- */

/* One dialog for anything destructive. It replaces both the tap-again
   buttons, which were easy to miss, and the browser's own confirm(), which
   freezes the page and looks nothing like the app. */
var confirmAction = null;
var confirmDecline = null;

export function openConfirm(opts) {
  document.getElementById("confirm-title").textContent = opts.title;
  document.getElementById("confirm-body").textContent = opts.body || "";
  var yes = document.getElementById("confirm-yes");
  yes.textContent = opts.confirmLabel || "Remove";
  yes.classList.toggle("is-danger", opts.danger !== false);
  document.getElementById("confirm-no").textContent = opts.cancelLabel || "Cancel";
  confirmAction = opts.onConfirm;
  confirmDecline = opts.onCancel || null;   // the "no" button; tapping outside just closes
  document.getElementById("confirm-overlay").classList.add("open");
}

function closeConfirm() {
  document.getElementById("confirm-overlay").classList.remove("open");
  confirmAction = null;
  confirmDecline = null;
}

/* ----------------------------- reusable list sheet ----------------------------- */

export function openListSheet(title, bodyHtml) {
  document.getElementById("list-modal-title").textContent = title;
  document.getElementById("list-modal-body").innerHTML = bodyHtml;
  document.getElementById("list-modal-overlay").classList.add("open");
  return document.getElementById("list-modal-body");
}

export function closeListSheet() {
  document.getElementById("list-modal-overlay").classList.remove("open");
}

/* ----------------------------- helpers ----------------------------- */

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

export function shortDate(iso) {
  var d = new Date(iso);
  return (d.getMonth() + 1) + "/" + d.getDate();
}

export var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* "Sat, Sep 6" -- the year is only shown when it isn't the current one. */
export function calendarDate(iso) {
  var d = new Date(iso);
  var label = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  if (d.getFullYear() !== new Date().getFullYear()) label += ", " + d.getFullYear();
  return label;
}

export function monthKey(iso) { var d = new Date(iso); return d.getFullYear() + "-" + d.getMonth(); }
export function monthLabel(iso) { var d = new Date(iso); return MONTHS_LONG[d.getMonth()] + " " + d.getFullYear(); }

/* <input type="date"> speaks local calendar days, ISO strings speak UTC
   instants -- these two convert without the off-by-one-day timezone bug. */
export function dateInputValue(iso) {
  var d = new Date(iso);
  var m = String(d.getMonth() + 1);
  var day = String(d.getDate());
  return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (day.length < 2 ? "0" + day : day);
}

export function timeInputValue(iso) {
  var d = new Date(iso);
  var h = String(d.getHours()), m = String(d.getMinutes());
  return (h.length < 2 ? "0" + h : h) + ":" + (m.length < 2 ? "0" + m : m);
}

/* Builds the instant from the local calendar day plus the local clock time,
   so an evening session sorts after a morning one on the same date. */
export function isoFromDateTime(dateStr, timeStr) {
  var now = new Date();
  var dp = (dateStr || dateInputValue(now.toISOString())).split("-");
  var tp = (timeStr || timeInputValue(now.toISOString())).split(":");
  var d = new Date(
    Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]),
    Number(tp[0]) || 0, Number(tp[1]) || 0
  );
  return d.toISOString();
}

/* End time on the same calendar day, rolling to the next day when a session
   runs past midnight (11:30pm -> 12:15am is 45 minutes, not negative). */
export function endIsoFrom(dateStr, startTimeStr, endTimeStr) {
  if (!endTimeStr) return null;
  var startIso = isoFromDateTime(dateStr, startTimeStr);
  var end = new Date(isoFromDateTime(dateStr, endTimeStr));
  if (end.getTime() <= new Date(startIso).getTime()) end.setDate(end.getDate() + 1);
  return end.toISOString();
}

export function durationOf(wk) {
  if (!wk || !wk.endedAt) return null;
  var secs = Math.round((new Date(wk.endedAt) - new Date(wk.performedAt)) / 1000);
  return secs > 0 ? secs : null;
}

/* "1h 12m" / "45m" */
export function formatDurationLong(sec) {
  if (sec == null) return "";
  var mins = Math.round(sec / 60);
  if (mins < 60) return mins + "m";
  var h = Math.floor(mins / 60), m = mins % 60;
  return h + "h" + (m ? " " + m + "m" : "");
}

/* "6:42 AM" */
export function formatTime(iso) {
  var d = new Date(iso);
  var h = d.getHours(), m = d.getMinutes();
  var ampm = h >= 12 ? "PM" : "AM";
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
}

/* Matches a workout against free text: person, title, gym, or any exercise. */
export function workoutMatches(wk, query) {
  if (!query) return true;
  var hay = [wk.userName, wk.title || ""];
  var g = wk.gymId ? findGym(wk.gymId) : null;
  if (g) { hay.push(g.name); hay.push(gymAddress(g)); }
  wk.exercises.forEach(function (we) {
    var exObj = findExercise(we.exerciseId);
    if (exObj) hay.push(exObj.name);
  });
  return hay.join(" ").toLowerCase().indexOf(query.toLowerCase()) !== -1;
}

/* Only rep-and-weight work has "sets" worth counting. A run has a time and
   a distance; calling that "1 set" is noise. */
export function repSetCount(exerciseBlocks) {
  var n = 0;
  exerciseBlocks.forEach(function (blk) {
    if (metricOf(blk) === "reps") n += blk.sets.length;
  });
  return n;
}

/* The short facts that describe a session, in the order worth reading. */
export function sessionFacts(wk) {
  var facts = [];
  var clock = durationOf(wk), logged = loggedSetTime(wk.exercises);
  if (clock) facts.push(formatDurationLong(clock));
  else if (logged) facts.push(formatDuration(logged));

  var dist = sessionDistance(wk.exercises);
  if (dist.mi) facts.push((Math.round(dist.mi * 100) / 100) + " mi");
  if (dist.km) facts.push((Math.round(dist.km * 100) / 100) + " km");

  var sets = repSetCount(wk.exercises);
  if (sets) facts.push(sets + (sets === 1 ? " set" : " sets"));
  if (isCardioWorkout(wk) && wk.exercises.length === 1) {
    var ex0 = findExercise(wk.exercises[0].exerciseId);
    var rate = cardioRate(wk.exercises[0].sets[0], activityProfile(ex0 ? ex0.name : ""));
    if (rate) facts.push(rate);
  }
  return facts;
}


export function exerciseChipsHtml(wk) {
  return wk.exercises.map(function (we) {
    var exObj = findExercise(we.exerciseId);
    var metric = metricOf(we);
    var best = bestValueIn(we.sets, metric);
    var unit = unitFor(we.sets, metric);
    var note = we.note ? ' <span class="chip-note" title="' + esc(we.note) + '">note</span>' : "";
    var eq = we.equipment ? ' <span class="chip-eq">' + esc(we.equipment) + '</span>' : "";
    return '<span class="exercise-chip">' + esc(exObj ? exObj.name : "Exercise") + eq +
      (best != null ? ' <span class="num">' + esc(formatValue(best, metric, unit)) + '</span>' : '') +
      note + '</span>';
  }).join("");
}



export function showToast(msg) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._h);
  showToast._h = setTimeout(function () { t.classList.remove("show"); }, 2200);
}

/* ----------------------------- tabs ----------------------------- */

var screens = ["home", "log", "friends", "gyms", "progress", "profile", "settings"];
export var currentTab = "home";

var MENU_SVG = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round">' +
  '<path d="M4 7h16M4 12h16M4 17h16"/></svg>';
var CLOSE_SVG = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round">' +
  '<path d="M6 6l12 12M18 6L6 18"/></svg>';

export var tabBeforeLog = "home";   // where Cancel on the log screen goes back to
var tabBeforeProgress = "profile";   // Progress has no tab of its own: Done goes back here

export function activateTab(name) {
  if (name === "log" && currentTab !== "log" && currentTab !== "settings") tabBeforeLog = currentTab || "home";
  if (name === "progress" && currentTab !== "progress" && currentTab !== "settings" && currentTab !== "log") {
    tabBeforeProgress = currentTab || "profile";
  }
  var switching = name !== currentTab;
  currentTab = name;
  renderBell();

  // the button shows what pressing it will do next
  var menu = document.getElementById("open-settings");
  var inSettings = name === "settings";
  menu.classList.toggle("is-open", inSettings);
  menu.innerHTML = inSettings ? CLOSE_SVG : MENU_SVG;
  menu.setAttribute("aria-label", inSettings ? "Close settings" : "Menu");

  screens.forEach(function (s) {
    document.getElementById("screen-" + s).classList.toggle("active", s === name);
  });
  document.querySelectorAll("[data-tab]").forEach(function (btn) {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === name);
  });
  if (name === "home") renderHome();
  if (name === "log") renderLog();
  if (name === "friends") renderFriends();
  if (name === "profile") renderProfile();
  if (name === "settings") renderSettings();
  if (name === "progress") renderProgress();
  if (name === "gyms") renderPlaces();

  // a new page starts at the top; a redraw of the same page stays put
  if (switching) document.getElementById("screen-" + name).scrollTop = 0;
}

/* ----------------------------- theme ----------------------------- */

/* Light is the default and matches MyFitnessPal. Dark is the same layout on
   a dark surface -- one attribute on <html> swaps every colour, because the
   stylesheet only ever names variables. */
var THEME_BAR = { light: "#f4f6f8", dark: "#12151a" };

export function applyTheme() {
  var t = state.settings.theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_BAR[t]);
}

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls these in a fixed order. */

export function startCore1() {
  state = load();
}

export function startCore2() {
  document.getElementById("confirm-no").addEventListener("click", function () {
    var no = confirmDecline;
    closeConfirm();
    if (no) no();
  });
  document.getElementById("confirm-yes").addEventListener("click", function () {
    var go = confirmAction;
    closeConfirm();
    if (go) go();
  });
  document.getElementById("confirm-overlay").addEventListener("click", function (e) {
    if (e.target.id === "confirm-overlay") closeConfirm();
  });
  document.getElementById("list-modal-close").addEventListener("click", closeListSheet);
  document.getElementById("list-modal-overlay").addEventListener("click", function (e) {
    if (e.target.id === "list-modal-overlay") closeListSheet();
  });
}

export function startCore3() {
  document.querySelectorAll("[data-tab]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      activateTab(btn.getAttribute("data-tab"));
    });
  });
  document.getElementById("progress-done").addEventListener("click", function () {
    activateTab(tabBeforeProgress || "profile");
  });
  document.getElementById("profile-progress").addEventListener("click", function () {
    activateTab("progress");
  });
  document.getElementById("profile-recap").addEventListener("click", function () { openRecap(); });
}

export function startCore4() {
  /* The app frame is position:fixed, and iOS does not shrink the layout
     viewport when the keyboard opens -- so the bottom of the app, including
     whatever you are typing in, ends up underneath it. visualViewport is the
     only thing that reports the covered height, so the frame is resized by
     hand and the field is scrolled back into view. */
  (function keyboardAware() {
    var vv = window.visualViewport;
    if (!vv) return;
    var frame = document.querySelector(".app-frame");

    function apply() {
      if (getComputedStyle(frame).position !== "fixed") {  // wide screens
        frame.style.bottom = "";
        document.documentElement.style.setProperty("--kb", "0px");
        document.documentElement.style.setProperty("--vvtop", "0px");
        document.body.classList.remove("kb-open");
        return;
      }
      var covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      frame.style.bottom = covered + "px";
      // modals sit outside the frame, so they read the same number from here
      document.documentElement.style.setProperty("--kb", covered + "px");
      // iOS can also slide the whole page up under the status bar to show a
      // field; sheets start below whatever has been pushed off the top
      document.documentElement.style.setProperty("--vvtop", Math.max(0, Math.round(vv.offsetTop)) + "px");
      // a tab bar pinned above the keyboard is just wasted room
      document.body.classList.toggle("kb-open", covered > 80);
    }

    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", function () { setTimeout(apply, 300); });
    apply();

    document.addEventListener("focusin", function (e) {
      var el = e.target;
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      // after the keyboard animation, so the frame has already been resized
      setTimeout(function () {
        if (document.activeElement === el && el.scrollIntoView) {
          el.scrollIntoView({ block: "center" });
        }
      }, 300);
    });
  })();
}
