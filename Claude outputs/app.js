import { loadState, saveState } from "./store.js";

(function () {
  "use strict";

  /* New key: a clean break from the demo data. Nothing from the seeded
     preview carries over. */
  var STORAGE_KEY = "gymsocial_v1";

  /* ----------------------------- starting state ----------------------------- */

  function uid(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9); }

  /* Movement pattern per exercise -- drives the calendar colors. */
  /* How a set is measured. An exercise picks one; every screen that reads
     sets asks here rather than assuming reps-and-weight. */
  var METRICS = {
    reps:     { label: "Reps",     col1: "Reps",  col2: "Weight",   unitKey: "unit",     units: ["lb", "kg"] },
    time:     { label: "Time",     col1: "Time",  col2: "Weight",   unitKey: "unit",     units: ["lb", "kg"] },
    distance: { label: "Distance", col1: "Time",  col2: "Distance", unitKey: "distUnit", units: ["mi", "km"] }
  };

  /* What the movement was loaded with. Chosen per exercise in a session, so
     "Bench, dumbbell" and "Bench, barbell" stay distinguishable without being
     two separate catalogue entries. Bodyweight drops the weight box. */
  /* Deliberately short: these five cover most of what gets logged, and a
     built-in cannot be deleted -- only hidden. Anything else you add yourself
     from the rail, and that one you can delete. */
  var BUILTIN_EQUIPMENT = ["Bodyweight", "Dumbbell", "Barbell", "Cable", "Machine"];

  function equipmentList(includeHidden) {
    var st = state.settings || {};
    var all = BUILTIN_EQUIPMENT.concat(st.customEquipment || []);
    if (includeHidden) return all;
    var off = st.hiddenEquipment || [];
    return all.filter(function (e) { return off.indexOf(e) === -1; });
  }

  /* Anything typed in gets its words capitalised -- "machine incline" files
     as "Machine Incline". A word that already has a capital in it is left
     alone, so "EZ bar" does not come back as "Ez Bar". */
  function titleCase(s) {
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
    added:   { label: "Weight added", suffix: " added" }
  };

  var DEFAULT_WEIGHT_MODE = {
    "Bodyweight": "added",
    "Dumbbell": "perHand",
    "Barbell": "total",
    "Cable": "total",
    "Machine": "total"
  };

  function weightMode(equipment) {
    if (!equipment) return "total";
    var set = (state.settings && state.settings.equipmentModes) || {};
    return WEIGHT_MODES[set[equipment]] ? set[equipment]
      : (DEFAULT_WEIGHT_MODE[equipment] || "total");
  }

  function weightLabel(blk) {
    return WEIGHT_MODES[weightMode(blk && blk.equipment)].label;
  }

  function isCustomEquipment(name) {
    return BUILTIN_EQUIPMENT.indexOf(name) === -1;
  }

  /* Reps and holds are loaded with something -- a weighted plank is the whole
     reason Time needs it too. A run is not, so Distance still has no rail. */
  function usesEquipment(metric) { return metric !== "distance"; }

  /* Nothing drops the weight column any more: on bodyweight it just becomes
     "Weight added" and stays empty unless you hung a plate off yourself. */
  function dropsWeight() { return false; }

  /* Exercises that are obviously not rep-and-weight start in the right mode. */
  var DEFAULT_METRIC = {
    "Plank": "time",
    "Treadmill Run": "distance",
    "Stationary Bike": "distance"
  };

  function metricOf(blk) {
    if (blk && blk.metric && METRICS[blk.metric]) return blk.metric;
    var exObj = blk ? findExercise(blk.exerciseId) : null;
    if (exObj && exObj.metric && METRICS[exObj.metric]) return exObj.metric;
    return "reps";
  }

  function formatDuration(sec) {
    if (sec == null) return "";
    if (sec < 60) return sec + "s";
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  /* Seconds -> the three boxes. Zero parts show as blank so the placeholders
     stay readable. */
  function splitDuration(sec) {
    if (sec == null) return { h: "", m: "", s: "" };
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return { h: h || "", m: m || "", s: s || "" };
  }

  function joinDuration(h, m, s) {
    var total = (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
    return total > 0 ? total : null;
  }

  function usesDuration(metric) { return metric === "time" || metric === "distance"; }

  /* The number a set is judged by, in its own mode. */
  function setValue(s, metric) {
    if (metric === "distance") return s.distance;
    if (metric === "time") return s.seconds;
    return s.weight;
  }

  function bestValueIn(sets, metric) {
    var best = null;
    sets.forEach(function (s) {
      var v = setValue(s, metric);
      if (v == null) return;
      if (best === null || v > best) best = v;
    });
    return best;
  }

  function unitFor(sets, metric) {
    var key = METRICS[metric].unitKey;
    var withUnit = sets.filter(function (s) { return s[key]; })[0];
    return withUnit ? withUnit[key] : METRICS[metric].units[0];
  }

  function formatValue(v, metric, unit) {
    if (v == null) return "";
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

  /* Four is enough to say something without turning into a keyboard. */
  var REACTIONS = ["\uD83D\uDCAA", "\uD83D\uDD25", "\uD83D\uDC4F", "\uD83D\uDE4C"];

  var EXERCISE_CATEGORIES = {
    "Barbell Bench Press": "push", "Incline Dumbbell Press": "push", "Overhead Press": "push",
    "Lateral Raise": "push", "Tricep Pushdown": "push",
    "Pull-Up": "pull", "Lat Pulldown": "pull", "Barbell Row": "pull", "Bicep Curl": "pull",
    "Back Squat": "legs", "Deadlift": "legs", "Romanian Deadlift": "legs", "Leg Press": "legs",
    "Plank": "core",
    "Treadmill Run": "cardio", "Stationary Bike": "cardio"
  };


  /* A clean starting state: just you and the standard exercise catalog.
     No sample people, gyms, or sessions -- everything from here is yours. */
  function seedState() {
    var exercises = [
      "Barbell Bench Press", "Incline Dumbbell Press", "Back Squat", "Deadlift",
      "Romanian Deadlift", "Overhead Press", "Pull-Up", "Barbell Row",
      "Bicep Curl", "Tricep Pushdown", "Lateral Raise", "Lat Pulldown",
      "Leg Press", "Plank", "Treadmill Run"
    ].map(function (name) {
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
    addDemoFriend(fresh);      // so the Friends page has something in it
    addDemoFriend2(fresh);
    return fresh;
  }

  /* ----------------------------- state / persistence ----------------------------- */

  var state = load();

  function load() {
    var saved = loadState(STORAGE_KEY);
    var s = saved ? migrate(saved) : seedState();
    refreshDemoDates(s);
    return s;
  }

  /* Fills in fields added after a version was saved, so an upgrade never
     wipes what someone already logged. */
  function migrate(s) {
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
      ["Barbell Bench Press", "Barbell", [[8, 165], [8, 175], [6, 185]]],
      ["Incline Dumbbell Press", "Dumbbell", [[10, 60], [10, 60], [8, 65]]],
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

  /* Who reacted with what. Stored on the workout, keyed by emoji, so a
     reaction travels with the session it belongs to. */
  function reactionsOf(wk) {
    if (!wk.reactions) wk.reactions = {};
    return wk.reactions;
  }

  function reactionCount(wk, emoji) {
    return (reactionsOf(wk)[emoji] || []).length;
  }

  function iReacted(wk, emoji) {
    return (reactionsOf(wk)[emoji] || []).indexOf(state.me.id) !== -1;
  }

  /* Which one you picked, if any -- there is only ever one. */
  function myReaction(wk) {
    var all = reactionsOf(wk);
    for (var e in all) {
      if (all[e].indexOf(state.me.id) !== -1) return e;
    }
    return null;
  }

  /* One reaction per person per session: picking another moves yours rather
     than adding a second, and picking the one you already chose clears it. */
  function toggleReaction(wk, emoji) {
    var all = reactionsOf(wk);
    var had = myReaction(wk);

    if (had) {
      all[had] = all[had].filter(function (id) { return id !== state.me.id; });
      if (!all[had].length) delete all[had];
    }
    if (had !== emoji) {
      (all[emoji] = all[emoji] || []).push(state.me.id);
      buzz(12);
    }
    persist();
  }

  function reactionBarHtml(wk) {
    return '<div class="react-bar">' + REACTIONS.map(function (e) {
      var n = reactionCount(wk, e);
      return '<button class="react' + (iReacted(wk, e) ? " is-mine" : "") +
        '" data-react="' + wk.id + '|' + e + '">' + e +
        (n ? '<span class="react-n">' + n + '</span>' : '') + '</button>';
    }).join("") + '</div>';
  }

  /* One handler for every reaction button inside a container. */
  function wireReactions(root, after) {
    root.querySelectorAll("[data-react]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();          // reacting is not opening the workout
        var parts = btn.getAttribute("data-react").split("|");
        var wk = state.workouts.filter(function (w) { return w.id === parts[0]; })[0];
        if (!wk) return;
        toggleReaction(wk, parts[1]);
        after();
      });
    });
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

  function persist() {
    saveState(STORAGE_KEY, state);
  }

  function findExercise(id) { return state.exercises.filter(function (e) { return e.id === id; })[0]; }
  function findGym(id) { return state.gyms.filter(function (g) { return g.id === id; })[0]; }

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
  function gymLabel(g) {
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
  function gymKey(g) {
    return [g.name, g.street, g.city, g.state]
      .map(function (v) { return String(v || "").trim().toLowerCase(); }).join("|");
  }

  function gymAddress(g) {
    if (!g) return "";
    return [g.street, gymPlace(g)].filter(Boolean).join(", ");
  }
  function findUser(id) { return state.users.filter(function (u) { return u.id === id; })[0]; }

  /* ----------------------------- your data ----------------------------- */

  /* Personal app: every query is scoped to you. The multi-user helpers that
     used to live here come back with the social layer. */
  function workoutsOf(userId) {
    return state.workouts.filter(function (w) { return w.userId === userId; });
  }

  function myWorkouts() { return workoutsOf(state.me.id); }

  /* One-way: whose sessions reach your home screen. Mutual connections, which
     are what unlock a private log, arrive with real accounts. */
  function friendsOf(userId) {
    return (state.follows || [])
      .filter(function (f) { return f[0] === userId; })
      .map(function (f) { return findUser(f[1]); })
      .filter(Boolean);
  }

  /* A photo if there is one, initials if not -- same box either way, so
     every list that shows people lines up. */
  function avatarHtml(user, extra) {
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
  function lastSessionFor(exerciseId, excludeWorkoutId) {
    var found = null;
    myWorkouts().forEach(function (wk) {
      if (excludeWorkoutId && wk.id === excludeWorkoutId) return;
      var blk = wk.exercises.filter(function (we) { return we.exerciseId === exerciseId; })[0];
      if (!blk) return;
      if (!found || new Date(wk.performedAt) > new Date(found.workout.performedAt)) {
        found = { workout: wk, block: blk };
      }
    });
    return found;
  }

  /* "3x8 @ 135lb", "3x45s", "2.0 mi in 18:30" -- collapses identical sets. */
  function summarizeSets(sets, metric, equipment) {
    metric = metric || "reps";
    var cfg = METRICS[metric], unitKey = cfg.unitKey;
    var wSuffix = metric === "distance" ? ""
      : WEIGHT_MODES[weightMode(equipment)].suffix;
    var parts = [], run = null;
    sets.forEach(function (s) {
      var sig = [s.reps, s.seconds, s.weight, s.distance, s[unitKey]].join("|");
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
      return mult + reps + (s.weight != null ? " @ " + s.weight + unit + wSuffix : "");
    }).join(", ");
  }

  /* Total weight moved, kept per unit rather than silently converting. */
  function sessionVolume(exerciseBlocks) {
    var vol = { lb: 0, kg: 0 };
    exerciseBlocks.forEach(function (blk) {
      if (metricOf(blk) !== "reps") return; // only rep work has tonnage
      blk.sets.forEach(function (s) {
        if (s.weight == null || s.reps == null) return;
        vol[s.unit === "kg" ? "kg" : "lb"] += s.weight * s.reps;
      });
    });
    return vol;
  }

  /* Time recorded on the sets themselves -- a run's 24:00, a plank's holds.
     Distinct from start-to-end clock time, which includes rest. */
  function loggedSetTime(exerciseBlocks) {
    var total = 0;
    exerciseBlocks.forEach(function (blk) {
      if (!usesDuration(metricOf(blk))) return;
      blk.sets.forEach(function (s) { if (s.seconds) total += s.seconds; });
    });
    return total || null;
  }

  function sessionDistance(exerciseBlocks) {
    var out = { mi: 0, km: 0 };
    exerciseBlocks.forEach(function (blk) {
      if (metricOf(blk) !== "distance") return;
      blk.sets.forEach(function (s) {
        if (s.distance == null) return;
        out[s.distUnit === "km" ? "km" : "mi"] += s.distance;
      });
    });
    return out;
  }


  /* A PR means beating your own previous best on that lift, measured the way
     that lift is measured -- heaviest weight, longest hold, furthest distance.
     The first time you log an exercise isn't a PR; that would cheapen it. */
  function detectPRs(exerciseBlocks, excludeWorkoutId) {
    var prs = [];
    exerciseBlocks.forEach(function (blk) {
      var metric = metricOf(blk);
      var now = bestValueIn(blk.sets, metric);
      if (now === null) return;
      var unit = unitFor(blk.sets, metric);

      var prev = null;
      myWorkouts().forEach(function (wk) {
        if (excludeWorkoutId && wk.id === excludeWorkoutId) return;
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

  /* Cheap tactility -- ignored on devices that don't support it. */
  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* no-op */ }
  }

  /* Gyms a person has actually trained at, with how many sessions each. */
  function gymsOf(userId) {
    var counts = {};
    workoutsOf(userId).forEach(function (w) {
      if (w.gymId) counts[w.gymId] = (counts[w.gymId] || 0) + 1;
    });
    return Object.keys(counts).map(function (gid) {
      return { gym: findGym(gid), sessions: counts[gid] };
    }).filter(function (row) { return !!row.gym; })
      .sort(function (a, b) { return b.sessions - a.sessions; });
  }

  function localDayKey(iso) {
    var d = new Date(iso);
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  }

  /* ----------------------------- streaks ----------------------------- */

  /* Weeks run Sunday -> Saturday, matching the calendar grid. */
  function weekStartOf(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  function startOfDay(date) { var d = new Date(date); d.setHours(0, 0, 0, 0); return d; }

  /* Three ways to count a streak, all sharing one rule: the period you're
     currently inside can't break the streak just because it isn't finished. */
  function computeStreak(userId) {
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

  var FLAME_SVG = '<svg class="streak-flame" viewBox="0 0 24 24"><path d="M12.5 2c.4 3-1.3 4.6-2.7 6C8.2 9.5 7 11 7 13.4A5.6 5.6 0 0 0 12.6 19a5.4 5.4 0 0 0 5.4-5.5c0-3.4-2.3-5-3.4-7.3-.4.9-1 1.5-1.7 2 .4-2.2-.1-4.6-.4-6.2Z"/></svg>';

  function streakUnit(mode) {
    return mode === "daily" ? "day" : mode === "weekly" ? "week" : "block";
  }

  /* The streak is a number now -- it lives in the third tile. What a card
     used to say in a sentence, this says in one line and a bar: where you
     are against the goal you set. It stays one line however long you train,
     which a growing list of counters would not. */
  function renderGoalBar(userId) {
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

  /* ----------------------------- settings ----------------------------- */

  function stepperHtml(id, label, value, suffix) {
    return '<div class="param-row">' +
      '<span class="param-label">' + label + '</span>' +
      '<div class="goal-stepper">' +
        '<button class="goal-btn" data-step="' + id + ':-1" aria-label="Decrease">&minus;</button>' +
        '<span class="goal-value">' + value + (suffix || "") + '</span>' +
        '<button class="goal-btn" data-step="' + id + ':1" aria-label="Increase">+</button>' +
      '</div></div>';
  }

  /* The equipment rails are drawn into the log and edit screens, so a change
     made in Settings has to reach them -- otherwise you close Settings and the
     rail is still showing what you just hid. */
  function refreshEquipmentRails(removed) {
    [draft, editDraft].forEach(function (d) {
      if (!d || !d.exercises) return;
      d.exercises.forEach(function (blk) {
        if (removed && blk.equipment === removed) blk.equipment = null;
      });
    });
    renderLog();
    if (document.getElementById("edit-modal-overlay").classList.contains("open")) renderEditModal();
  }

  /* Your identity lives in two places once state has been through storage. */
  function updateMe(field, value) {
    state.me[field] = value;
    var mirror = findUser(state.me.id);
    if (mirror) mirror[field] = value;
    persist();
  }

  /* Square-cropped and scaled down before it is stored: a phone photo
     straight from the camera would be megabytes, and browser storage is
     a few. 256px is plenty for a 46px circle on a retina screen. */
  function setAvatarFromFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { showToast("Couldn't read that image."); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { showToast("That file isn't an image."); };
      img.onload = function () {
        var size = 256;
        var side = Math.min(img.width, img.height);
        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(
          img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        var data;
        try { data = canvas.toDataURL("image/jpeg", 0.82); }
        catch (e) { showToast("Couldn't read that image."); return; }
        updateMe("avatar", data);
        renderProfile();
        renderHome();
        showToast("Photo updated.");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function renderSettings() {
    var el = document.getElementById("settings-body");
    var st = state.settings;
    var mode = st.streakMode;



    var params = "";
    if (mode === "weekly") {
      params = stepperHtml("weeklyGoal", "Workouts per week", st.weeklyGoal, "/wk");
    } else if (mode === "custom") {
      params = stepperHtml("customCount", "Workouts", st.customCount) +
        stepperHtml("customDays", "Every", st.customDays, " days");
    }

    var hidden = st.hiddenEquipment || [];
    var theme = st.theme === "dark" ? "dark" : "light";

    var modeHelp = {
      weekly: "Counts Sunday-Saturday weeks that hit your target. Rest days never break it.",
      daily: "Counts consecutive days trained. Strict -- a single rest day resets it.",
      custom: "Counts rolling windows that hit your target. Good for a flexible schedule."
    }[mode];

    el.innerHTML =
      '<div>' +
        '<div class="setting-block">' +
          '<label class="field-label">Backup</label>' +
          '<div class="action-row" style="margin-bottom:0;">' +
            '<button class="btn btn-ghost" data-backup="export">Export data</button>' +
            '<button class="btn btn-ghost" data-backup="import">Restore</button>' +
          '</div>' +
          '<p class="setting-help">Browser storage isn\'t permanent. Export a copy you can paste back in, or move to a new phone.</p>' +
        '</div>' +

        '<div class="setting-block">' +
          '<label class="field-label">Equipment</label>' +
          '<div class="equip-wrap">' +
            equipmentList(true).map(function (eq) {
              return isCustomEquipment(eq)
                ? '<button class="equip-btn" data-del-equip="' + esc(eq) + '">' + esc(eq) +
                    '<span class="x">&times;</span></button>'
                : '<button class="equip-btn is-builtin' + (hidden.indexOf(eq) !== -1 ? " is-off" : "") +
                    '" data-hide-equip="' + esc(eq) + '">' + esc(eq) + '</button>';
            }).join("") +
          '</div>' +
          '<div class="equip-add">' +
            '<input type="text" id="set-equip" placeholder="Add your own">' +
            '<button class="btn btn-ghost" data-add-equip="1">Add</button>' +
          '</div>' +
          '<p class="setting-help">Tap a built-in to hide it from the rail; tap one of yours to delete it. ' +
            'Past sessions keep whatever they were logged with. The rail only shows on Reps.</p>' +
        '</div>' +

        '<div class="setting-block">' +
          '<label class="field-label">Appearance</label>' +
          '<div class="segmented">' +
            [["light", "Light"], ["dark", "Dark"]].map(function (o) {
              return '<button class="seg-btn' + (theme === o[0] ? " selected" : "") +
                '" data-theme-set="' + o[0] + '">' + o[1] + '</button>';
            }).join("") +
          '</div>' +
        '</div>' +

        '<div class="setting-block">' +
          '<label class="field-label">Danger zone</label>' +
          '<button class="btn btn-ghost btn-block" id="reset-demo-btn" ' +
            'style="color:var(--danger);border-color:var(--danger);">Erase all my data</button>' +
          '<p class="setting-help">Deletes every workout, gym and exercise in this browser. ' +
            'Export a backup first.</p>' +
        '</div>' +

        '<div class="setting-block">' +
          '<label class="field-label">Streak counted by</label>' +
          '<div class="segmented">' +
            ["weekly", "daily", "custom"].map(function (m) {
              return '<button class="seg-btn' + (mode === m ? " selected" : "") + '" data-mode="' + m + '">' +
                m.charAt(0).toUpperCase() + m.slice(1) + '</button>';
            }).join("") +
          '</div>' +
          params +
          '<p class="setting-help">' + modeHelp + '</p>' +
        '</div>' +
      '</div>';

    wireEraseButton(el);
    el.querySelectorAll("[data-backup]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.getAttribute("data-backup") === "export") openExportSheet();
        else openImportSheet();
      });
    });

    var equipInput = el.querySelector("#set-equip");
    el.querySelector("[data-add-equip]").addEventListener("click", function () {
      var v = titleCase(equipInput.value);
      if (!v) return;
      var taken = equipmentList().filter(function (x) {
        return x.toLowerCase() === v.toLowerCase();
      })[0];
      if (taken) { showToast("\"" + taken + "\" is already on the list."); return; }
      state.settings.customEquipment.push(v);
      persist();
      renderSettings();
      refreshEquipmentRails(null);
    });
    el.querySelectorAll("[data-hide-equip]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-hide-equip");
        var off = state.settings.hiddenEquipment;
        var at = off.indexOf(name);
        if (at === -1) off.push(name); else off.splice(at, 1);
        persist();
        renderSettings();
        refreshEquipmentRails(at === -1 ? name : null);
      });
    });
    el.querySelectorAll("[data-theme-set]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.settings.theme = btn.getAttribute("data-theme-set");
        persist();
        applyTheme();
        renderSettings();
      });
    });
    el.querySelectorAll("[data-del-equip]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var name = btn.getAttribute("data-del-equip");
        state.settings.customEquipment = state.settings.customEquipment.filter(function (x) {
          return x !== name;
        });
        persist();
        renderSettings();
        refreshEquipmentRails(name);
      });
    });

    el.querySelectorAll("[data-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.settings.streakMode = btn.getAttribute("data-mode");
        persist();
        renderSettings();
        renderHome();
      });
    });

    el.querySelectorAll("[data-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var parts = btn.getAttribute("data-step").split(":");
        var key = parts[0], delta = Number(parts[1]);
        var limits = { weeklyGoal: [1, 7], customCount: [1, 30], customDays: [2, 60] };
        var lo = limits[key][0], hi = limits[key][1];
        state.settings[key] = Math.min(hi, Math.max(lo, state.settings[key] + delta));
        persist();
        renderSettings();
        renderHome();
      });
    });
  }

  function wireEraseButton(el) {
    var btn = el.querySelector("#reset-demo-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var n = state.workouts.filter(function (w) { return w.userId === state.me.id; }).length;
      openConfirm({
        title: "Erase everything?",
        body: "This deletes " + n + (n === 1 ? " workout" : " workouts") +
          ", your gyms and your exercises. It cannot be undone -- export a backup first.",
        confirmLabel: "Erase everything",
        onConfirm: function () {
          state = seedState();
          selectedExerciseId = null;
          calendarMonth = null;
          resetDraft();
          persist();
          applyTheme();
          activateTab("home");
          showToast("Everything erased.");
        }
      });
    });
  }

  document.getElementById("avatar-input").addEventListener("change", function (e) {
    setAvatarFromFile(e.target.files && e.target.files[0]);
    e.target.value = "";          // so picking the same file twice still fires
  });

  /* ----------------------------- calendar ----------------------------- */

  var calendarMonth = null; // first day of the displayed month

  function renderCalendar(userId, isMe) {
    var today = new Date();
    if (!calendarMonth) calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    var year = calendarMonth.getFullYear();
    var month = calendarMonth.getMonth();
    document.getElementById("cal-month").textContent = MONTHS_LONG[month] + " " + year;

    // Bucket this person's workouts by local calendar day.
    var byDay = {};
    workoutsOf(userId).slice()
      .sort(function (a, b) { return new Date(a.performedAt) - new Date(b.performedAt); })
      .forEach(function (wk) {
        var k = localDayKey(wk.performedAt);
        (byDay[k] = byDay[k] || []).push(wk);
      });

    var firstWeekday = new Date(year, month, 1).getDay(); // Sunday-first
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayKey = localDayKey(today.toISOString());

    var html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      .map(function (d) { return '<div class="cal-wd">' + d[0] + '</div>'; }).join("");

    for (var b = 0; b < firstWeekday; b++) html += '<div class="cal-day blank"></div>';

    for (var day = 1; day <= daysInMonth; day++) {
      var key = year + "-" + month + "-" + day;
      var dayWorkouts = byDay[key] || [];
      var isToday = key === todayKey;
      var isFuture = new Date(year, month, day) > new Date(today.getFullYear(), today.getMonth(), today.getDate());
      var cls = ["cal-day"];
      if (dayWorkouts.length) cls.push("trained");
      if (isToday) cls.push("today");
      // Your own calendar is interactive: tap a session to edit it, tap an
      // empty past day to log one on that date.
      var tappable = isMe && (dayWorkouts.length > 0 || !isFuture);
      if (tappable) cls.push("tappable");

      var tag = tappable ? "button" : "div";
      var title = dayWorkouts.length
        ? esc(dayWorkouts.map(function (w) { return w.title || "Workout"; }).join(", "))
        : "";
      html += "<" + tag + ' class="' + cls.join(" ") + '"' +
        (tappable ? ' data-cal-day="' + key + '"' : "") +
        (title ? ' title="' + title + '"' : "") + ">" +
          '<span>' + day + '</span>' +
          (dayWorkouts.length
            ? '<span class="cal-marks' + (dayWorkouts.length > 1 ? " is-multi" : "") + '">' +
                new Array(Math.min(dayWorkouts.length, 3) + 1).join(FLAME_SVG.replace("streak-flame", "cal-flame")) +
              '</span>'
            : "") +
        "</" + tag + ">";
    }

    document.getElementById("cal-grid").innerHTML = html;

    document.getElementById("cal-hint").textContent = isMe
      ? "Tap any day to see what you and your friends did, or to log one on that date."
      : "";

    // Don't browse past the current month -- there's nothing to see there.
    document.getElementById("cal-next").disabled =
      year === today.getFullYear() && month === today.getMonth();

    document.querySelectorAll("[data-cal-day]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        onCalendarDayTap(cell.getAttribute("data-cal-day"), byDay);
      });
    });
  }

  function dateFromDayKey(key) {
    var p = key.split("-");
    return new Date(Number(p[0]), Number(p[1]), Number(p[2]));
  }

  /* Tapping a day opens that day: what you did, what the people you follow
     did, and -- if you logged nothing -- a way to log it now, already dated.
     The calendar is how you move through time on Home. */
  function onCalendarDayTap(key, byDay) {
    var d = dateFromDayKey(key);
    var iso = d.toISOString();
    var mine = byDay[key] || [];
    var isFuture = d > new Date(new Date().setHours(23, 59, 59, 999));

    var html = '<div class="day-section">You</div>';

    html += mine.length
      ? mine.map(function (wk) {
          var gymObj = wk.gymId ? findGym(wk.gymId) : null;
          return '<button class="person-row" data-day-workout="' + wk.id + '">' +
            '<span class="day-time">' + esc(formatTime(wk.performedAt)) + '</span>' +
            '<span class="person-body">' +
              '<span class="person-name">' + esc(wk.title || "Workout") + '</span>' +
              '<span class="person-sub">' +
                [gymObj ? esc(gymLabel(gymObj)) : null].concat(sessionFacts(wk).map(esc))
                  .filter(Boolean).join(' &middot; ') + '</span></span>' +
            '<span class="chevron">&rsaquo;</span></button>';
        }).join("")
      : (isFuture
          ? '<div class="empty-state" style="padding:14px 2px;">Nothing logged yet.</div>'
          : '<button class="btn btn-ghost btn-block add-gym-link" id="day-log" ' +
              'style="margin:0 0 4px;">+ Log a workout for this day</button>');

    var friends = friendsOf(state.me.id);
    var theirs = [];
    friends.forEach(function (u) {
      workoutsOf(u.id).forEach(function (wk) {
        if (localDayKey(wk.performedAt) === key) theirs.push({ user: u, wk: wk });
      });
    });
    theirs.sort(function (a, b) {
      return new Date(b.wk.performedAt) - new Date(a.wk.performedAt);
    });

    html += '<div class="day-section">Friends</div>';
    html += theirs.length
      ? theirs.map(function (row) {
          var exCount = row.wk.exercises.length;
          return '<button class="person-row" data-day-workout="' + row.wk.id + '">' +
            avatarHtml(row.user) +
            '<span class="person-body">' +
              '<span class="person-name">' + esc(row.user.name) + '</span>' +
              '<span class="person-sub">' +
                [esc(row.wk.title || "Workout"), esc(formatTime(row.wk.performedAt)),
                 exCount + (exCount === 1 ? " exercise" : " exercises")]
                  .concat(sessionFacts(row.wk).map(esc)).join(' &middot; ') +
              '</span></span>' +
            '<span class="chevron">&rsaquo;</span></button>';
        }).join("")
      : '<div class="empty-state" style="padding:14px 2px;">' +
          (friends.length ? "Nobody you follow logged on this day."
                          : "No friends yet.") + '</div>';

    var el = openListSheet(calendarDate(iso), html);

    el.querySelectorAll("[data-day-workout]").forEach(function (row) {
      row.addEventListener("click", function () {
        closeListSheet();
        openWorkoutDetail(row.getAttribute("data-day-workout"));
      });
    });

    var logBtn = el.querySelector("#day-log");
    if (logBtn) {
      logBtn.addEventListener("click", function () {
        closeListSheet();
        resetDraft();
        draft.date = dateInputValue(iso);
        activateTab("log");
        showToast("Logging for " + calendarDate(iso) + ".");
      });
    }
  }

  document.getElementById("cal-prev").addEventListener("click", function () {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderHome();
  });
  document.getElementById("cal-next").addEventListener("click", function () {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderHome();
  });

  /* ----------------------------- are you sure ----------------------------- */

  /* One dialog for anything destructive. It replaces both the tap-again
     buttons, which were easy to miss, and the browser's own confirm(), which
     freezes the page and looks nothing like the app. */
  var confirmAction = null;

  function openConfirm(opts) {
    document.getElementById("confirm-title").textContent = opts.title;
    document.getElementById("confirm-body").textContent = opts.body || "";
    var yes = document.getElementById("confirm-yes");
    yes.textContent = opts.confirmLabel || "Remove";
    yes.classList.toggle("is-danger", opts.danger !== false);
    confirmAction = opts.onConfirm;
    document.getElementById("confirm-overlay").classList.add("open");
  }

  function closeConfirm() {
    document.getElementById("confirm-overlay").classList.remove("open");
    confirmAction = null;
  }

  document.getElementById("confirm-no").addEventListener("click", closeConfirm);
  document.getElementById("confirm-yes").addEventListener("click", function () {
    var go = confirmAction;
    closeConfirm();
    if (go) go();
  });
  document.getElementById("confirm-overlay").addEventListener("click", function (e) {
    if (e.target.id === "confirm-overlay") closeConfirm();
  });

  /* ----------------------------- reusable list sheet ----------------------------- */

  function openListSheet(title, bodyHtml) {
    document.getElementById("list-modal-title").textContent = title;
    document.getElementById("list-modal-body").innerHTML = bodyHtml;
    document.getElementById("list-modal-overlay").classList.add("open");
    return document.getElementById("list-modal-body");
  }

  function closeListSheet() {
    document.getElementById("list-modal-overlay").classList.remove("open");
  }

  document.getElementById("list-modal-close").addEventListener("click", closeListSheet);
  document.getElementById("list-modal-overlay").addEventListener("click", function (e) {
    if (e.target.id === "list-modal-overlay") closeListSheet();
  });

  /* ----------------------------- session summary ----------------------------- */

  /* Closes the loop on a save: what you moved, what you beat, where the
     streak stands. */
  function openSessionSummary(workout, prs) {
    var vol = sessionVolume(workout.exercises);
    var sets = repSetCount(workout.exercises);
    var gymObj = workout.gymId ? findGym(workout.gymId) : null;
    var streak = computeStreak(state.me.id);

    var volParts = [];
    if (vol.lb) volParts.push(Math.round(vol.lb).toLocaleString() + " lb");
    if (vol.kg) volParts.push(Math.round(vol.kg).toLocaleString() + " kg");

    var html =
      '<div class="summary-head">' +
        '<div class="summary-title">' + esc(workout.title || "Session logged") + '</div>' +
        '<div class="summary-meta">' + (gymObj ? esc(gymObj.name) + ' &middot; ' : '') +
          calendarDate(workout.performedAt) + ' &middot; ' + esc(formatTime(workout.performedAt)) + '</div>' +
        (gymObj && gymAddress(gymObj)
          ? '<div class="summary-place">' + esc(gymAddress(gymObj)) + '</div>' : '') +
      '</div>';

    if (prs.length) {
      html += '<div class="pr-banner">' +
        FLAME_SVG.replace("streak-flame", "pr-flame") +
        '<div><div class="pr-banner-title">' +
          (prs.length === 1 ? "New personal record" : prs.length + " new personal records") + '</div>' +
          prs.map(function (p) {
            return '<div class="pr-line">' + esc(p.name) + ' <span class="num">' + esc(p.display) +
              '</span> <span class="pr-delta">+' + esc(p.delta) + ' on your best</span></div>';
          }).join("") +
        '</div></div>';
    }

    var dist = sessionDistance(workout.exercises);
    var distParts = [];
    if (dist.mi) distParts.push((Math.round(dist.mi * 100) / 100) + " mi");
    if (dist.km) distParts.push((Math.round(dist.km * 100) / 100) + " km");

    // Show what this session actually produced: tonnage for lifting, distance
    // for cardio, calories when the watch supplied them.
    var mins = durationOf(workout);
    var tiles = [
      { value: workout.exercises.length, label: workout.exercises.length === 1 ? "Exercise" : "Exercises", count: true }
    ];
    if (sets) tiles.push({ value: sets, label: sets === 1 ? "Set" : "Sets", count: true });
    var setTime = loggedSetTime(workout.exercises);
    if (mins) {
      tiles.push({ value: formatDurationLong(mins), label: "Duration" });
    } else if (setTime) {
      // no clock time given, but the sets themselves recorded time
      tiles.push({ value: formatDuration(setTime), label: "Time" });
    }
    if (distParts.length) {
      tiles.push({ value: distParts[0].split(" ")[0], label: "Distance " + distParts[0].split(" ")[1] });
    } else if (volParts.length) {
      tiles.push({ value: volParts[0].split(" ")[0], label: "Volume " + volParts[0].split(" ")[1] });
    }
    if (workout.calories != null) {
      tiles.push({ value: workout.calories, label: "Calories", count: true });
    }
    // Keep the grid tidy; anything past four is mentioned underneath instead.
    var overflow = tiles.slice(4).map(function (t) { return t.value + " " + t.label.toLowerCase(); });
    tiles = tiles.slice(0, 4);

    html += '<div class="stat-grid" style="margin:14px 0 0;' +
      (tiles.length === 4 ? "grid-template-columns:repeat(2,1fr);" : "") + '">' +
      tiles.map(function (t) {
        return '<div class="stat-tile"><span class="num"' +
          (t.count ? ' data-count="' + t.value + '">0' : '>' + esc(String(t.value))) +
          '</span><span class="label">' + esc(t.label) + '</span></div>';
      }).join("") + '</div>';

    var extras = [];
    if (distParts.length && volParts.length) extras.push(volParts[0] + " of volume lifted");
    overflow.forEach(function (o) { extras.push(o); });
    if (extras.length) html += '<p class="setting-help">Plus ' + esc(extras.join(", ")) + '.</p>';

    if (volParts.length > 1) {
      html += '<p class="setting-help">Plus ' + esc(volParts.slice(1).join(" and ")) + ' logged in other units.</p>';
    }

    html += '<p class="summary-streak">' +
      (streak.current > 0
        ? '<strong>' + streak.current + ' ' + (streak.mode === "daily" ? "day" : streak.mode === "weekly" ? "week" : "block") +
          (streak.current === 1 ? "" : "s") + ' in a row.</strong> '
        : "") +
      (streak.mode === "daily"
        ? (streak.inPeriod ? "Logged today." : "")
        : streak.inPeriod + " of " + streak.goal +
          (streak.mode === "weekly" ? " this week." : " in the last " + streak.days + " days.")) +
      '</p>' +
      '<button class="btn btn-primary btn-block" id="summary-done" style="margin-top:16px;">Done</button>';

    var el = openListSheet("Nice work", html);
    el.querySelector("#summary-done").addEventListener("click", closeListSheet);

    // Numbers tick up rather than just appearing.
    el.querySelectorAll("[data-count]").forEach(function (node) {
      var target = Number(node.getAttribute("data-count")), step = 0;
      var timer = setInterval(function () {
        step += Math.max(1, Math.ceil(target / 12));
        if (step >= target) { step = target; clearInterval(timer); }
        node.textContent = step;
      }, 40);
    });
  }


  /* ----------------------------- friends ----------------------------- */

  /* A page of its own: everyone you follow, newest first, grouped by day so
     a busy week still reads as a list rather than a wall. */
  /* Which day the Friends page is showing. One day at a time keeps the page
     the same size however many people you follow; the arrows move it. */
  var friendsDay = new Date();

  function dayLabelFor(d) {
    var key = localDayKey(d.toISOString());
    var today = new Date();
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === localDayKey(today.toISOString())) return "Today";
    if (key === localDayKey(yesterday.toISOString())) return "Yesterday";
    return calendarDate(d.toISOString());
  }

  function renderFriends() {
    var friends = friendsOf(state.me.id);
    var subEl = document.getElementById("friends-sub");
    var el = document.getElementById("friends-feed");
    var nav = document.querySelector(".day-nav");

    subEl.textContent = friends.length
      ? friends.length + (friends.length === 1 ? " friend" : " friends") + " you follow"
      : "";

    if (!friends.length) {
      nav.hidden = true;
      el.innerHTML = '<div class="empty-state">No friends yet. Once accounts are in, ' +
        'the people you follow show up here.</div>';
      return;
    }
    nav.hidden = false;

    var dayKeyWanted = localDayKey(friendsDay.toISOString());
    var todayKey = localDayKey(new Date().toISOString());
    document.getElementById("friends-day").textContent = dayLabelFor(friendsDay);
    // there is nothing to see in the future
    document.getElementById("friends-next").disabled = dayKeyWanted === todayKey;

    var rows = [];
    friends.forEach(function (u) {
      workoutsOf(u.id).forEach(function (wk) {
        if (localDayKey(wk.performedAt) === dayKeyWanted) rows.push({ user: u, wk: wk });
      });
    });
    rows.sort(function (a, b) {
      return new Date(b.wk.performedAt) - new Date(a.wk.performedAt);
    });

    /* Everyone you follow, in one line: who trained on this day and who did
       not. It answers the question the page is really for without making you
       scroll, and it stays one line as the list grows. */
    // rows are newest first, so the first one per person is their latest
    var trained = {};
    rows.forEach(function (r) {
      (trained[r.user.id] = trained[r.user.id] || []).push(r.wk.id);
    });
    var nTrained = Object.keys(trained).length;

    var strip = '<div class="friend-strip">' +
      friends.map(function (u) {
        var theirs = trained[u.id] || [];
        return '<button class="friend-dot' + (theirs.length ? " is-on" : "") + '"' +
          (theirs.length ? ' data-friend-wk="' + theirs[0] + '"' : " disabled") +
          ' title="' + esc(u.name) +
            (theirs.length > 1 ? " -- " + theirs.length + " sessions" : "") + '">' +
          '<span class="friend-dot-av">' + avatarHtml(u) +
            (theirs.length > 1
              ? '<span class="friend-dot-count">' + theirs.length + '</span>' : '') +
          '</span>' +
          '<span class="friend-dot-name">' + esc(u.name.split(" ")[0]) + '</span>' +
        '</button>';
      }).join("") +
      '</div>' +
      '<p class="friend-tally">' +
        (nTrained
          ? '<strong>' + nTrained + '</strong> of ' + friends.length + ' trained' +
            (dayKeyWanted === todayKey ? " today" : " that day")
          : (dayKeyWanted === todayKey ? "Nobody has logged yet today" : "Nobody logged that day")) +
      '</p>';

    if (!rows.length) {
      el.innerHTML = strip;
      el.querySelectorAll("[data-friend-wk]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          openWorkoutDetail(btn.getAttribute("data-friend-wk"));
        });
      });
      return;
    }

    var html = strip;
    rows.forEach(function (row) {
      var gymObj = row.wk.gymId ? findGym(row.wk.gymId) : null;
      var exCount = row.wk.exercises.length;
      var theirs = trained[row.user.id] || [];
      // their sessions are newest first, so count back from the end
      var nth = theirs.length > 1
        ? (theirs.length - theirs.indexOf(row.wk.id)) : 0;
      html += '<div class="friend-card">' +
        '<button class="friend-open" data-friend-wk="' + row.wk.id + '">' +
          avatarHtml(row.user) +
          '<span class="person-body">' +
            '<span class="person-name">' + esc(row.user.name) +
              (nth ? '<span class="nth-tag">#' + nth + ' today</span>' : '') + '</span>' +
            '<span class="friend-what">' + esc(row.wk.title || "Workout") + '</span>' +
            '<span class="person-sub">' +
              [esc(formatTime(row.wk.performedAt)),
               exCount + (exCount === 1 ? " exercise" : " exercises")]
                .concat(sessionFacts(row.wk).map(esc))
                .concat(gymObj ? [esc(gymLabel(gymObj))] : [])
                .join(' &middot; ') +
            '</span>' +
          '</span>' +
          '<span class="chevron">&rsaquo;</span>' +
        '</button>' +
        reactionBarHtml(row.wk) +
      '</div>';
    });
    el.innerHTML = html;

    el.querySelectorAll("[data-friend-wk]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openWorkoutDetail(btn.getAttribute("data-friend-wk"));
      });
    });
    wireReactions(el, renderFriends);
  }

  /* Managing who you follow belongs with the feed they appear in, not
     buried in Settings. Removing someone takes their sessions with them --
     locally there is no server for their log to stay on. */
  function openFriendsManage() {
    var friends = friendsOf(state.me.id);
    var body =
      '<div class="equip-add" style="margin-bottom:6px;">' +
        '<input type="text" id="friend-new" placeholder="Name" autocomplete="off">' +
        '<button class="btn btn-ghost" id="friend-add">Add</button>' +
      '</div>' +
      '<p class="setting-help" style="margin-top:6px;">Until accounts are in, this adds a ' +
        'local friend with no sessions -- enough to see how the feed behaves.</p>' +
      (friends.length
        ? friends.map(function (u) {
            var n = workoutsOf(u.id).length;
            return '<div class="manage-row">' +
              avatarHtml(u) +
              '<span class="person-body">' +
                '<span class="person-name">' + esc(u.name) + '</span>' +
                '<span class="person-sub">' + n + (n === 1 ? " session" : " sessions") + '</span>' +
              '</span>' +
              '<button class="btn-danger-text manage-drop" data-drop-friend="' + esc(u.id) + '">Remove</button>' +
            '</div>';
          }).join("")
        : '<div class="empty-state">Nobody yet.</div>');

    var el = openListSheet("Your friends", body);

    var input = el.querySelector("#friend-new");
    el.querySelector("#friend-add").addEventListener("click", function () {
      var name = titleCase(input.value);
      if (!name) { showToast("Give them a name."); return; }
      var taken = friendsOf(state.me.id).some(function (u) {
        return u.name.toLowerCase() === name.toLowerCase();
      });
      if (taken) { showToast("You already follow " + name + "."); return; }
      var u = { id: uid("usr"), name: name, handle: name.toLowerCase().replace(/\s+/g, ""), isPrivate: false };
      state.users.push(u);
      state.follows.push([state.me.id, u.id]);
      persist();
      closeListSheet();
      renderFriends();
      openFriendsManage();
      showToast("Following " + name + ".");
    });

    el.querySelectorAll("[data-drop-friend]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-drop-friend");
        var u = findUser(id);
        if (!u) return;
        var n = workoutsOf(id).length;
        openConfirm({
          title: "Remove " + u.name + "?",
          body: n
            ? "They come off your feed and " + n + (n === 1 ? " session goes" : " sessions go") + " with them."
            : "They come off your feed.",
          confirmLabel: "Remove",
          onConfirm: function () {
            state.follows = state.follows.filter(function (f) { return f[1] !== id; });
            state.users = state.users.filter(function (x) { return x.id !== id; });
            state.workouts = state.workouts.filter(function (w) { return w.userId !== id; });
            persist();
            closeListSheet();
            renderFriends();
            renderHome();
            openFriendsManage();
            showToast("Removed " + u.name + ".");
          }
        });
      });
    });
  }

  document.getElementById("friends-manage").addEventListener("click", openFriendsManage);

  function shiftFriendsDay(delta) {
    var d = new Date(friendsDay);
    d.setDate(d.getDate() + delta);
    if (d > new Date()) return;
    friendsDay = d;
    renderFriends();
  }

  document.getElementById("friends-prev").addEventListener("click", function () { shiftFriendsDay(-1); });
  document.getElementById("friends-next").addEventListener("click", function () { shiftFriendsDay(1); });

  /* ----------------------------- a logged session ----------------------------- */

  /* What you get when you tap a session: the whole thing laid out to be read,
     or handed to someone. Editing is a button, not what tapping does. */
  function openWorkoutDetail(workoutId) {
    var wk = state.workouts.filter(function (w) { return w.id === workoutId; })[0];
    if (!wk) return;
    var mine = wk.userId === state.me.id;
    var gymObj = wk.gymId ? findGym(wk.gymId) : null;
    var vol = sessionVolume(wk.exercises);
    var sets = repSetCount(wk.exercises);
    var mins = durationOf(wk);
    var setTime = loggedSetTime(wk.exercises);
    var dist = sessionDistance(wk.exercises);

    var tiles = [{ value: wk.exercises.length,
                   label: wk.exercises.length === 1 ? "Exercise" : "Exercises" }];
    if (sets) tiles.push({ value: sets, label: sets === 1 ? "Set" : "Sets" });
    if (mins) tiles.push({ value: formatDurationLong(mins), label: "Duration" });
    else if (setTime) tiles.push({ value: formatDuration(setTime), label: "Time" });
    if (dist.mi) tiles.push({ value: Math.round(dist.mi * 100) / 100, label: "Miles" });
    else if (dist.km) tiles.push({ value: Math.round(dist.km * 100) / 100, label: "Km" });
    else if (vol.lb) tiles.push({ value: Math.round(vol.lb).toLocaleString(), label: "Volume lb" });
    else if (vol.kg) tiles.push({ value: Math.round(vol.kg).toLocaleString(), label: "Volume kg" });
    if (wk.calories != null) tiles.push({ value: wk.calories, label: "Calories" });
    tiles = tiles.slice(0, 4);

    var ssLabels = supersetLabels(wk.exercises);

    var who = mine ? null : findUser(wk.userId);
    var html =
      '<div class="detail-head">' +
        (who
          ? '<div class="detail-who">' + avatarHtml(who) +
            '<span>' + esc(who.name) + '</span></div>'
          : '') +
        '<div class="detail-title">' + esc(wk.title || "Workout") + '</div>' +
        '<div class="detail-when">' + calendarDate(wk.performedAt) + ' &middot; ' +
          esc(formatTime(wk.performedAt)) +
          (wk.endedAt ? ' &ndash; ' + esc(formatTime(wk.endedAt)) : '') + '</div>' +
        (gymObj
          ? '<div class="detail-gym"><span class="detail-gym-name">' + esc(gymLabel(gymObj)) + '</span>' +
            (gymAddress(gymObj) ? '<span class="detail-gym-addr">' + esc(gymAddress(gymObj)) + '</span>' : '') +
            '</div>'
          : '') +
      '</div>';

    html += '<div class="stat-grid" style="margin:16px 0 20px;' +
      (tiles.length === 4 ? "grid-template-columns:repeat(2,1fr);" : "") + '">' +
      tiles.map(function (t) {
        return '<div class="stat-tile"><span class="num">' + esc(String(t.value)) +
          '</span><span class="label">' + esc(t.label) + '</span></div>';
      }).join("") + '</div>';

    html += wk.exercises.map(function (blk, i) {
      var exObj = findExercise(blk.exerciseId);
      var prev = wk.exercises[i - 1];
      var linked = blk.superset && prev && prev.superset === blk.superset;
      return '<div class="detail-ex' + (linked ? " is-linked" : "") + '">' +
        '<div class="detail-ex-head">' +
          '<span class="detail-ex-name">' +
            (ssLabels[i] ? '<span class="detail-ss">' + ssLabels[i] + '</span>' : '') +
            esc(exObj ? exObj.name : "Exercise") + '</span>' +
          (blk.equipment ? '<span class="detail-ex-eq">' + esc(blk.equipment) + '</span>' : '') +
        '</div>' +
        '<div class="detail-ex-sets num">' +
          esc(summarizeSets(blk.sets, metricOf(blk), blk.equipment)) + '</div>' +
        (blk.note ? '<div class="detail-ex-note">' + esc(blk.note) + '</div>' : '') +
      '</div>';
    }).join("");

    if (mine) {
      html += '<button class="btn btn-ghost btn-block" id="detail-edit" style="margin-top:18px;">Edit workout</button>';
    } else {
      html += '<div class="detail-react">' + reactionBarHtml(wk) + '</div>';
    }

    var el = openListSheet("Workout", html);
    if (mine) {
      el.querySelector("#detail-edit").addEventListener("click", function () {
        closeListSheet();
        openEditWorkout(workoutId);
      });
    } else {
      wireReactions(el, function () {
        openWorkoutDetail(workoutId);   // redraw the sheet with the new count
        renderFriends();
      });
    }
  }

  /* ----------------------------- settings sheet ----------------------------- */

  /* The menu button is a toggle: it opens Settings, and pressing it again
     puts you back on whatever screen you came from rather than on Home. */
  var settingsReturnTo = "home";

  function openSettings() {
    if (currentTab === "settings") {
      activateTab(settingsReturnTo || "home");
      return;
    }
    settingsReturnTo = currentTab;
    activateTab("settings");
  }

  document.getElementById("open-settings").addEventListener("click", openSettings);

  /* ----------------------------- backup ----------------------------- */

  /* The artifact viewer blocks page-initiated downloads, so a backup is text
     you copy out and paste back in -- which also happens to be the format
     that can seed a real database later. */
  function openExportSheet() {
    var json = JSON.stringify(state, null, 2);
    var el = openListSheet("Export your data",
      '<p class="setting-help" style="margin-top:0;">Copy this and keep it somewhere safe &mdash; a note, an email to yourself, a file. Paste it into Restore to bring it back.</p>' +
      '<textarea id="export-box" class="backup-box" readonly>' + esc(json) + '</textarea>' +
      '<button class="btn btn-primary btn-block" id="copy-export">Copy to clipboard</button>' +
      '<p class="setting-help" id="copy-note">' + (state.workouts.length) +
        ' workouts &middot; ' + state.gyms.length + ' gyms &middot; ' +
        Math.round(json.length / 1024) + ' KB</p>');

    el.querySelector("#copy-export").addEventListener("click", function () {
      var box = document.getElementById("export-box");
      var done = function () { document.getElementById("copy-note").textContent = "Copied."; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(done, function () { box.select(); });
      } else {
        box.select();
        box.setSelectionRange(0, json.length);
        try { document.execCommand("copy"); done(); } catch (e) { /* user copies manually */ }
      }
    });
  }

  function openImportSheet() {
    var el = openListSheet("Restore from backup",
      '<p class="setting-help" style="margin-top:0;">Paste an exported backup. This replaces everything currently in this browser.</p>' +
      '<textarea id="import-box" class="backup-box" placeholder="Paste your backup here..."></textarea>' +
      '<button class="btn btn-primary btn-block" id="do-import">Restore</button>' +
      '<p class="setting-help" id="import-note"></p>');

    el.querySelector("#do-import").addEventListener("click", function () {
      var raw = document.getElementById("import-box").value.trim();
      var note = document.getElementById("import-note");
      if (!raw) { note.textContent = "Paste a backup first."; return; }
      var parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { note.textContent = "That isn't valid backup text."; return; }
      if (!parsed || !Array.isArray(parsed.workouts) || !parsed.me) {
        note.textContent = "That JSON doesn't look like a GymSocial backup.";
        return;
      }
      openConfirm({
        title: "Replace everything?",
        body: "The backup has " + parsed.workouts.length +
          (parsed.workouts.length === 1 ? " workout" : " workouts") +
          ". Whatever is in this browser now is overwritten.",
        confirmLabel: "Restore",
        onConfirm: function () {
          state = migrate(parsed);
          selectedExerciseId = null;
          calendarMonth = null;
          resetDraft();
          persist();
          applyTheme();
          closeListSheet();
          activateTab("home");
          showToast("Restored " + state.workouts.length + " workouts.");
        }
      });
    });
  }

  /* Opens the gyms sheet; tapping a gym opens its detail page. */
  function openGymsSheet(userId) {
    var u = findUser(userId);
    var rows = gymsOf(userId);
    var isMe = userId === state.me.id;
    var body = rows.length
      ? rows.map(function (row) {
          return '<button class="gym-row" data-gym-sheet="' + row.gym.id + '" style="width:100%;font-family:inherit;text-align:left;">' +
            '<span><span class="gym-row-name" style="display:block;">' + esc(row.gym.name) + '</span>' +
            '<span class="gym-row-city" style="display:block;">' + (row.gym.city ? esc(row.gym.city) + ' &middot; ' : '') +
            row.sessions + (row.sessions === 1 ? ' session' : ' sessions') + '</span></span>' +
            '<span class="chevron">&rsaquo;</span></button>';
        }).join("")
      : '<div class="empty-state">' + (isMe
          ? "You haven't checked into a gym yet."
          : esc(u.name.split(" ")[0]) + " hasn't checked into a gym yet.") + '</div>';
    var el = openListSheet(isMe ? "Your Gyms" : u.name.split(" ")[0] + "'s Gyms", body);
    el.querySelectorAll("[data-gym-sheet]").forEach(function (row) {
      row.addEventListener("click", function () {
        closeListSheet();
        openGymModal(row.getAttribute("data-gym-sheet"));
      });
    });
  }

  /* ----------------------------- helpers ----------------------------- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function shortDate(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /* "Sat, Sep 6" -- the year is only shown when it isn't the current one. */
  function calendarDate(iso) {
    var d = new Date(iso);
    var label = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
    if (d.getFullYear() !== new Date().getFullYear()) label += ", " + d.getFullYear();
    return label;
  }

  function monthKey(iso) { var d = new Date(iso); return d.getFullYear() + "-" + d.getMonth(); }
  function monthLabel(iso) { var d = new Date(iso); return MONTHS_LONG[d.getMonth()] + " " + d.getFullYear(); }

  /* <input type="date"> speaks local calendar days, ISO strings speak UTC
     instants -- these two convert without the off-by-one-day timezone bug. */
  function dateInputValue(iso) {
    var d = new Date(iso);
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (day.length < 2 ? "0" + day : day);
  }

  function timeInputValue(iso) {
    var d = new Date(iso);
    var h = String(d.getHours()), m = String(d.getMinutes());
    return (h.length < 2 ? "0" + h : h) + ":" + (m.length < 2 ? "0" + m : m);
  }

  /* Builds the instant from the local calendar day plus the local clock time,
     so an evening session sorts after a morning one on the same date. */
  function isoFromDateTime(dateStr, timeStr) {
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
  function endIsoFrom(dateStr, startTimeStr, endTimeStr) {
    if (!endTimeStr) return null;
    var startIso = isoFromDateTime(dateStr, startTimeStr);
    var end = new Date(isoFromDateTime(dateStr, endTimeStr));
    if (end.getTime() <= new Date(startIso).getTime()) end.setDate(end.getDate() + 1);
    return end.toISOString();
  }

  function durationOf(wk) {
    if (!wk || !wk.endedAt) return null;
    var secs = Math.round((new Date(wk.endedAt) - new Date(wk.performedAt)) / 1000);
    return secs > 0 ? secs : null;
  }

  /* "1h 12m" / "45m" */
  function formatDurationLong(sec) {
    if (sec == null) return "";
    var mins = Math.round(sec / 60);
    if (mins < 60) return mins + "m";
    var h = Math.floor(mins / 60), m = mins % 60;
    return h + "h" + (m ? " " + m + "m" : "");
  }

  /* "6:42 AM" */
  function formatTime(iso) {
    var d = new Date(iso);
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + (m < 10 ? "0" : "") + m + " " + ampm;
  }

  /* Matches a workout against free text: person, title, gym, or any exercise. */
  function workoutMatches(wk, query) {
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
  function repSetCount(exerciseBlocks) {
    var n = 0;
    exerciseBlocks.forEach(function (blk) {
      if (metricOf(blk) === "reps") n += blk.sets.length;
    });
    return n;
  }

  /* The short facts that describe a session, in the order worth reading. */
  function sessionFacts(wk) {
    var facts = [];
    var clock = durationOf(wk), logged = loggedSetTime(wk.exercises);
    if (clock) facts.push(formatDurationLong(clock));
    else if (logged) facts.push(formatDuration(logged));

    var dist = sessionDistance(wk.exercises);
    if (dist.mi) facts.push((Math.round(dist.mi * 100) / 100) + " mi");
    if (dist.km) facts.push((Math.round(dist.km * 100) / 100) + " km");

    var sets = repSetCount(wk.exercises);
    if (sets) facts.push(sets + (sets === 1 ? " set" : " sets"));
    return facts;
  }


  function exerciseChipsHtml(wk) {
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



  function showToast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ----------------------------- tabs ----------------------------- */

  var screens = ["home", "log", "friends", "progress", "profile", "settings"];
  var currentTab = "home";

  var MENU_SVG = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round">' +
    '<path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var CLOSE_SVG = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round">' +
    '<path d="M6 6l12 12M18 6L6 18"/></svg>';

  function activateTab(name) {
    currentTab = name;

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

  }

  document.querySelectorAll("[data-tab]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      activateTab(btn.getAttribute("data-tab"));
    });
  });

  /* ----------------------------- feed ----------------------------- */

  /* ----------------------------- edit workout ----------------------------- */

  var editingId = null;
  var editDraft = { gymId: "", exercises: [] };

  function openEditWorkout(workoutId) {
    var wk = state.workouts.filter(function (w) { return w.id === workoutId; })[0];
    if (!wk || wk.userId !== state.me.id) return;

    editingId = workoutId;
    // Deep-copy so Cancel really cancels -- nothing touches state until Save.
    editDraft = {
      gymId: wk.gymId || "",
      date: dateInputValue(wk.performedAt),
      startTime: timeInputValue(wk.performedAt),
      endTime: wk.endedAt ? timeInputValue(wk.endedAt) : "",
      exercises: wk.exercises.map(function (blk) {
        return {
          exerciseId: blk.exerciseId,
          metric: metricOf(blk),
          note: blk.note || "",
          superset: blk.superset || null,
          sets: blk.sets.map(function (s) {
            return {
              reps: s.reps, seconds: s.seconds, weight: s.weight, distance: s.distance,
              unit: s.unit || "lb", distUnit: s.distUnit || "mi"
            };
          })
        };
      })
    };
    document.getElementById("edit-title").value = wk.title || "";
    document.getElementById("edit-calories").value = wk.calories == null ? "" : wk.calories;
    renderEditModal();
    document.getElementById("edit-modal-overlay").classList.add("open");
  }

  function closeEditWorkout() {
    document.getElementById("edit-modal-overlay").classList.remove("open");
    editingId = null;
  }

  function renderEditModal() {
    document.getElementById("edit-gym").innerHTML = gymOptionsHtml(editDraft.gymId);
    document.getElementById("edit-date").value = editDraft.date;
    document.getElementById("edit-start").value = editDraft.startTime;
    document.getElementById("edit-end").value = editDraft.endTime || "";
    updateDurationReadout("edit", editDraft);
    renderExerciseBlocks(document.getElementById("edit-exercise-blocks"), editDraft, renderEditModal, editingId);
  }

  document.getElementById("edit-gym").addEventListener("change", function (e) { editDraft.gymId = e.target.value; });
  document.getElementById("edit-date").addEventListener("change", function (e) { editDraft.date = e.target.value; });
  document.getElementById("edit-start").addEventListener("change", function (e) {
    editDraft.startTime = e.target.value; updateDurationReadout("edit", editDraft);
  });
  document.getElementById("edit-end").addEventListener("change", function (e) {
    editDraft.endTime = e.target.value; updateDurationReadout("edit", editDraft);
  });
  document.getElementById("edit-modal-close").addEventListener("click", closeEditWorkout);
  document.getElementById("edit-modal-overlay").addEventListener("click", function (e) {
    if (e.target.id === "edit-modal-overlay") closeEditWorkout();
  });

  document.getElementById("edit-add-exercise-btn").addEventListener("click", function () {
    openExercisePicker(function (exObj) {
      editDraft.exercises.push(blockFromLastTime(exObj, editingId));
      renderEditModal();
    });
  });

  document.getElementById("edit-save-btn").addEventListener("click", function () {
    var wk = state.workouts.filter(function (w) { return w.id === editingId; })[0];
    if (!wk) return;
    var cleanExercises = cleanDraftExercises(editDraft);
    if (!cleanExercises.length) { showToast("Keep at least one set, or delete the workout."); return; }

    wk.gymId = editDraft.gymId || null;
    wk.title = document.getElementById("edit-title").value.trim() || null;
    var editCal = document.getElementById("edit-calories").value;
    wk.calories = editCal === "" || isNaN(Number(editCal)) ? null : Number(editCal);
    wk.exercises = cleanExercises;
    wk.performedAt = isoFromDateTime(editDraft.date, editDraft.startTime);
    wk.endedAt = endIsoFrom(editDraft.date, editDraft.startTime, editDraft.endTime);
    persist();
    closeEditWorkout();
    renderHome();
    showToast("Workout updated.");
  });

  document.getElementById("edit-delete-btn").addEventListener("click", function () {
    var wk = state.workouts.filter(function (w) { return w.id === editingId; })[0];
    var id = editingId;
    openConfirm({
      title: "Delete " + ((wk && wk.title) || "this workout") + "?",
      body: "The sets, notes and check-in go with it. This cannot be undone.",
      confirmLabel: "Delete",
      onConfirm: function () {
        state.workouts = state.workouts.filter(function (w) { return w.id !== id; });
        selectedExerciseId = null;
        persist();
        closeEditWorkout();
        renderHome();
        showToast("Workout deleted.");
      }
    });
  });

  /* ----------------------------- log ----------------------------- */

  var DRAFT_KEY = "gymsocial_draft_v1";
  var draft = { gymId: "", exercises: [] };

  function freshDraft() {
    return {
      gymId: state.gyms[0] ? state.gyms[0].id : "",
      date: dateInputValue(new Date().toISOString()),
      startTime: timeInputValue(new Date().toISOString()),
      endTime: "",
      exercises: []
    };
  }

  /* An end time you typed wins. Left blank, the session ended when you hit
     Save -- but only if that is actually after the start, so a session saved
     in the same minute it began records no end instead of rolling a day. */
  function defaultEndIso(d) {
    if (d.endTime) return endIsoFrom(d.date, d.startTime, d.endTime);
    var now = new Date();
    var startedAt = new Date(isoFromDateTime(d.date, d.startTime));
    var end = dateInputValue(now.toISOString()) === d.date
      ? now
      : new Date(endIsoFrom(d.date, d.startTime, timeInputValue(now.toISOString())));
    return end > startedAt ? end.toISOString() : null;
  }

  function resetDraft() {
    draft = freshDraft();
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ }
  }

  /* A half-logged session used to live only in memory, so swiping the app
     away lost it. It is written out on every change now and picked back up
     on the next open. */
  function saveDraft() {
    try {
      if (!draft.exercises || !draft.exercises.length) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) { /* storage full or blocked -- the session still works */ }
  }

  function restoreDraft() {
    var raw;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return false; }
    if (!raw) return false;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return false; }
    if (!saved || !Array.isArray(saved.exercises)) return false;
    if (!saved.exercises.length) return false;   // nothing worth restoring
    draft = {
      gymId: saved.gymId || "",
      date: saved.date || dateInputValue(new Date().toISOString()),
      startTime: saved.startTime || timeInputValue(new Date().toISOString()),
      endTime: saved.endTime || "",
      exercises: saved.exercises
    };
    return true;
  }

  draft = freshDraft();     // not resetDraft(): that would clear what we are about to restore

  /* One listener for the whole screen rather than one per control, so a new
     field can never be added and silently miss being saved. */
  (function autosaveDraft() {
    var screen = document.getElementById("screen-log");
    var timer = null;
    var schedule = function () {
      clearTimeout(timer);
      timer = setTimeout(saveDraft, 250);
    };
    ["input", "change", "click"].forEach(function (evt) {
      screen.addEventListener(evt, schedule, true);
    });
  })();

  /* Shared editor for exercise blocks + set rows -- used by both the Log tab
     and the Edit Workout sheet, so the two always behave identically. */
  /* A group of one isn't a superset. Run after any change that can orphan a
     group -- unlinking, or removing an exercise out of the middle of one. */
  function normalizeSupersets(exercises) {
    var counts = {};
    exercises.forEach(function (blk) {
      if (blk.superset) counts[blk.superset] = (counts[blk.superset] || 0) + 1;
    });
    exercises.forEach(function (blk) {
      if (blk.superset && counts[blk.superset] < 2) blk.superset = null;
    });
  }

  /* Superset groups get letters in order of appearance: A1/A2, B1/B2... */
  function supersetLabels(exercises) {
    var order = [], labels = {};
    exercises.forEach(function (blk) {
      if (!blk.superset) return;
      if (order.indexOf(blk.superset) === -1) order.push(blk.superset);
    });
    order.forEach(function (gid, i) { labels[gid] = String.fromCharCode(65 + i); });
    var counters = {};
    return exercises.map(function (blk) {
      if (!blk.superset) return null;
      counters[blk.superset] = (counters[blk.superset] || 0) + 1;
      return labels[blk.superset] + counters[blk.superset];
    });
  }

  function renderExerciseBlocks(containerEl, draftObj, rerender, excludeWorkoutId) {
    if (!draftObj.exercises.length) {
      containerEl.innerHTML = '<div class="empty-state">No exercises added yet. Tap "+ Add Exercise" below.</div>';
      return;
    }
    var ssLabels = supersetLabels(draftObj.exercises);

    /* Re-rendering throws away the equipment rails, and with them how far
       each one was scrolled. Remember, rebuild, put them back. */
    var railScroll = [].map.call(containerEl.querySelectorAll(".equip-scroll"),
      function (r) { return r.scrollLeft; });

    containerEl.innerHTML = draftObj.exercises.map(function (blk, i) {
      var exObj = findExercise(blk.exerciseId);
      var metric = metricOf(blk);
      var cfg = METRICS[metric];
      var unitKey = cfg.unitKey;

      var last = lastSessionFor(blk.exerciseId, excludeWorkoutId);
      var lastLine = last
        ? '<div class="last-time">Last time <strong>' +
            esc(summarizeSets(last.block.sets, metricOf(last.block), last.block.equipment)) +
            '</strong> &middot; ' + shortDate(last.workout.performedAt) + '</div>'
        : '<div class="last-time is-new">First time logging this</div>';

      var dur = usesDuration(metric);
      var noWt = dropsWeight(blk, metric);
      var rows = blk.sets.map(function (s, si) {
        var v2 = metric === "distance"
          ? (s.distance == null ? "" : s.distance)
          : (s.weight == null ? "" : s.weight);
        var firstCell;
        if (dur) {
          var p = splitDuration(s.seconds);
          firstCell =
            '<span class="dur-group">' +
              '<input type="number" inputmode="numeric" class="dur-h" placeholder="h" value="' + esc(p.h) + '">' +
              '<input type="number" inputmode="numeric" class="dur-m" placeholder="m" value="' + esc(p.m) + '">' +
              '<input type="number" inputmode="numeric" class="dur-s" placeholder="s" value="' + esc(p.s) + '">' +
            '</span>';
        } else {
          firstCell = '<input type="number" inputmode="numeric" placeholder="Reps" class="set-v1" value="' +
            esc(s.reps == null ? "" : s.reps) + '">';
        }
        var col2 = metric === "distance" ? cfg.col2 : weightLabel(blk);
        var weightCells = noWt ? "" :
          '<input type="number" inputmode="decimal" placeholder="' + esc(col2) + '" class="set-v2" value="' + esc(v2) + '">' +
          '<button class="unit-toggle" data-unit-toggle>' + (s[unitKey] || cfg.units[0]) + '</button>';
        return '' +
          '<div class="set-row' + (dur ? " has-duration" : "") + (noWt ? " no-weight" : "") +
              '" data-ex="' + i + '" data-set="' + si + '">' +
            '<span class="set-index">' + (si + 1) + '</span>' +
            firstCell +
            weightCells +
            '<button class="set-remove" data-remove-set="' + si + '" data-remove-set-ex="' + i + '" aria-label="Remove set ' + (si + 1) + '">&times;</button>' +
          '</div>';
      }).join("");

      var noteOpen = blk.showNote || (blk.note && blk.note.length);
      var noteHtml = noteOpen
        ? '<textarea class="note-input" rows="2" data-note="' + i + '" placeholder="How did it feel? Form cues, aches...">' + esc(blk.note || "") + '</textarea>'
        : '<button class="add-set-link" data-add-note="' + i + '">+ Note</button>';

      var prevBlk = draftObj.exercises[i - 1];
      var linked = blk.superset && prevBlk && prevBlk.superset === blk.superset;
      var ssBtn = i > 0
        ? '<button class="superset-link' + (linked ? " is-on" : "") + '" data-superset="' + i + '">' +
            (linked ? "&#8646; Superset" : "&#8646; Superset with above") + '</button>'
        : "";

      return '' +
        '<div class="exercise-block' + (blk.superset ? " in-superset" : "") + '">' +
          (ssLabels[i] ? '<span class="ss-tag">' + ssLabels[i] + '</span>' : "") +
          '<div class="exercise-block-head">' +
            '<h3 class="ex-name" data-rename="' + i + '" title="Tap to rename">' +
              esc(exObj ? exObj.name : "Exercise") + '<span class="ex-pencil">&#9998;</span></h3>' +
            '<button class="btn-danger-text" data-remove-ex="' + i + '">Remove</button></div>' +
          lastLine +
          '<div class="metric-switch">' +
            ["reps", "time", "distance"].map(function (m) {
              return '<button class="metric-btn' + (metric === m ? " selected" : "") +
                '" data-metric="' + i + ':' + m + '">' + METRICS[m].label + '</button>';
            }).join("") +
          '</div>' +
          (usesEquipment(metric)
            ? '<div class="equip-scroll">' +
                equipmentList().map(function (eq) {
                  return '<button class="equip-btn' + (blk.equipment === eq ? " selected" : "") +
                    '" data-equip="' + i + ':' + esc(eq) + '">' + esc(eq) + '</button>';
                }).join("") +
                '<button class="equip-btn is-add" data-equip-add="' + i + '">+ Add</button>' +
              '</div>'
            : "") +
          '<div class="set-head' + (dur ? " has-duration" : "") + (noWt ? " no-weight" : "") + '"><span></span>' +
            (dur
              ? '<span class="dur-head"><span>Hr</span><span>Min</span><span>Sec</span></span>'
              : '<span>' + cfg.col1 + '</span>') +
            (noWt ? '<span></span>'
                  : '<span>' + esc(metric === "distance" ? cfg.col2 : weightLabel(blk)) +
                    '</span><span></span><span></span>') +
          '</div>' +
          rows +
          '<div class="block-foot">' +
            '<button class="add-set-link" data-add-set="' + i + '">+ Add set</button>' +
            ssBtn +
          '</div>' +
          noteHtml +
        '</div>';
    }).join("");

    containerEl.querySelectorAll(".equip-scroll").forEach(function (rail, i) {
      if (railScroll[i] != null) { rail.scrollLeft = railScroll[i]; return; }
      // first render of this block: bring whatever is already chosen into view
      var sel = rail.querySelector(".equip-btn.selected");
      if (sel) rail.scrollLeft = sel.offsetLeft - (rail.clientWidth - sel.offsetWidth) / 2;
    });

    containerEl.querySelectorAll("[data-remove-ex]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        draftObj.exercises.splice(Number(btn.getAttribute("data-remove-ex")), 1);
        normalizeSupersets(draftObj.exercises); // removal can orphan a group too
        rerender();
      });
    });
    containerEl.querySelectorAll("[data-add-set]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var blk = draftObj.exercises[Number(btn.getAttribute("data-add-set"))];
        var last = blk.sets[blk.sets.length - 1] || {};
        blk.sets.push({
          reps: last.reps, seconds: last.seconds, weight: last.weight,
          distance: last.distance, unit: last.unit || "lb", distUnit: last.distUnit || "mi"
        });
        rerender();
      });
    });
    containerEl.querySelectorAll("[data-remove-set]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var blk = draftObj.exercises[Number(btn.getAttribute("data-remove-set-ex"))];
        if (blk.sets.length === 1) {
          showToast("An exercise needs one set -- remove the exercise instead.");
          return;
        }
        blk.sets.splice(Number(btn.getAttribute("data-remove-set")), 1);
        rerender();
      });
    });

    // switching how an exercise is measured
    containerEl.querySelectorAll("[data-metric]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var parts = btn.getAttribute("data-metric").split(":");
        var blk = draftObj.exercises[Number(parts[0])];
        blk.metric = parts[1];
        if (!usesEquipment(blk.metric)) blk.equipment = null;
        rerender();
      });
    });

    // what it was loaded with
    containerEl.querySelectorAll("[data-equip]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var raw = btn.getAttribute("data-equip");
        var cut = raw.indexOf(":");                 // a custom name may contain one
        var blk = draftObj.exercises[Number(raw.slice(0, cut))];
        var eq = raw.slice(cut + 1);
        blk.equipment = blk.equipment === eq ? null : eq;   // tap again to clear
        rerender();
      });
    });

    // add one without leaving the set you are logging
    containerEl.querySelectorAll("[data-equip-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var blk = draftObj.exercises[Number(btn.getAttribute("data-equip-add"))];
        var input = document.createElement("input");
        input.type = "text";
        input.className = "equip-new";
        input.placeholder = "Name it";
        btn.parentNode.replaceChild(input, btn);
        input.focus();
        var done = false;
        var finish = function () {
          if (done) return;
          done = true;
          var v = titleCase(input.value);
          if (v) {
            var taken = equipmentList(true).filter(function (x) {
              return x.toLowerCase() === v.toLowerCase();
            })[0];
            if (taken) {
              // already exists, possibly hidden -- bring it back rather than
              // quietly making a second one with the same name
              state.settings.hiddenEquipment = state.settings.hiddenEquipment.filter(function (x) {
                return x !== taken;
              });
              blk.equipment = taken;
            } else {
              state.settings.customEquipment.push(v);
              blk.equipment = v;
            }
            persist();
          }
          setTimeout(rerender, 0);
        };
        input.addEventListener("blur", finish);
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        });
      });
    });

    // renaming reaches the catalogue entry, so every session using it follows
    containerEl.querySelectorAll("[data-rename]").forEach(function (head) {
      head.addEventListener("click", function () {
        var blk = draftObj.exercises[Number(head.getAttribute("data-rename"))];
        var exObj = findExercise(blk.exerciseId);
        if (!exObj) return;
        var input = document.createElement("input");
        input.type = "text";
        input.className = "ex-name-input";
        input.value = exObj.name;
        head.parentNode.replaceChild(input, head);
        input.focus();
        input.select();
        var done = false;
        var finish = function () {
          if (done) return;
          done = true;
          var v = titleCase(input.value);
          if (v && v !== exObj.name) {
            var clash = state.exercises.filter(function (e) {
              return e.id !== exObj.id && e.name.toLowerCase() === v.toLowerCase();
            })[0];
            if (clash) showToast("You already have an exercise called that.");
            else { exObj.name = v; persist(); }
          }
          // re-rendering from inside blur tears this input out mid-event
          setTimeout(rerender, 0);
        };
        input.addEventListener("blur", finish);
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        });
      });
    });

    // notes
    containerEl.querySelectorAll("[data-add-note]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        draftObj.exercises[Number(btn.getAttribute("data-add-note"))].showNote = true;
        rerender();
      });
    });
    containerEl.querySelectorAll("[data-note]").forEach(function (input) {
      // a textarea with no scrollbar: it grows to whatever you typed
      var grow = function () {
        input.style.height = "auto";
        input.style.height = input.scrollHeight + "px";
      };
      grow();
      input.addEventListener("input", function (e) {
        draftObj.exercises[Number(input.getAttribute("data-note"))].note = e.target.value;
        grow();
      });
    });

    // superset linking
    containerEl.querySelectorAll("[data-superset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-superset"));
        var blk = draftObj.exercises[i], prev = draftObj.exercises[i - 1];
        if (!prev) return;
        if (blk.superset && prev.superset === blk.superset) {
          blk.superset = null; // unlink just this one
        } else {
          if (!prev.superset) prev.superset = uid("ss");
          blk.superset = prev.superset;
        }
        normalizeSupersets(draftObj.exercises);
        rerender();
      });
    });

    containerEl.querySelectorAll(".set-row").forEach(function (row) {
      var blk = draftObj.exercises[Number(row.getAttribute("data-ex"))];
      var setObj = blk.sets[Number(row.getAttribute("data-set"))];
      var metric = metricOf(blk);
      var cfg = METRICS[metric];

      if (usesDuration(metric)) {
        var hEl = row.querySelector(".dur-h"), mEl = row.querySelector(".dur-m"), sEl = row.querySelector(".dur-s");
        var readDur = function () { setObj.seconds = joinDuration(hEl.value, mEl.value, sEl.value); };
        [hEl, mEl, sEl].forEach(function (input) {
          input.addEventListener("input", readDur);
          // 90 in the seconds box becomes 1m 30s when you leave it
          input.addEventListener("change", function () {
            readDur();
            var p = splitDuration(setObj.seconds);
            hEl.value = p.h; mEl.value = p.m; sEl.value = p.s;
          });
        });
      } else {
        row.querySelector(".set-v1").addEventListener("input", function (e) {
          var raw = e.target.value;
          setObj.reps = raw === "" ? null : Number(raw);
        });
      }
      var v2El = row.querySelector(".set-v2");          // absent on bodyweight
      if (v2El) {
        v2El.addEventListener("input", function (e) {
          var raw = e.target.value;
          var val = raw === "" ? null : Number(raw);
          if (metric === "distance") setObj.distance = val;
          else setObj.weight = val;
        });
      }
      var unitEl = row.querySelector("[data-unit-toggle]");
      if (unitEl) {
        unitEl.addEventListener("click", function (e) {
          var key = cfg.unitKey;
          var cur = setObj[key] || cfg.units[0];
          setObj[key] = cur === cfg.units[0] ? cfg.units[1] : cfg.units[0];
          e.target.textContent = setObj[key];
        });
      }
    });
  }

  /* Writes straight to the readout rather than re-rendering, so the field you
     just left doesn't get torn out from under you. */
  function updateDurationReadout(prefix, draftObj) {
    var el = document.getElementById(prefix + "-duration");
    if (!el) return;
    var endIso = endIsoFrom(draftObj.date, draftObj.startTime, draftObj.endTime);
    if (!endIso) { el.innerHTML = "&mdash;"; el.classList.remove("has-value"); return; }
    var secs = Math.round((new Date(endIso) - new Date(isoFromDateTime(draftObj.date, draftObj.startTime))) / 1000);
    el.textContent = formatDurationLong(secs);
    el.classList.add("has-value");
  }

  function gymOptionsHtml(selectedId) {
    return '<option value="">No check-in</option>' + state.gyms.map(function (g) {
      return '<option value="' + g.id + '"' + (g.id === selectedId ? " selected" : "") + '>' + esc(gymLabel(g)) + '</option>';
    }).join("");
  }

  /* Start from last time's numbers so a session is a target to beat, not a
     blank form to retype. */
  function blockFromLastTime(exObj, excludeWorkoutId) {
    var last = lastSessionFor(exObj.id, excludeWorkoutId);
    var metric = last ? metricOf(last.block) : (exObj.metric || "reps");
    var equip = (last && last.block.equipment) || exObj.equipment || null;
    if (!last || !last.block.sets.length) {
      return { exerciseId: exObj.id, metric: metric, equipment: equip,
        sets: [{ reps: null, seconds: null, weight: null, distance: null, unit: "lb", distUnit: "mi" }] };
    }
    return {
      exerciseId: exObj.id,
      metric: metric,
      equipment: equip,
      // Same shape as last time -- as many sets, same units -- but the boxes
      // start empty. The "Last time" line above is the reference; nothing
      // gets logged just because you tapped Save.
      sets: last.block.sets.map(function (s) {
        return {
          reps: null, seconds: null, weight: null, distance: null,
          unit: s.unit || "lb", distUnit: s.distUnit || "mi"
        };
      })
    };
  }

  /* Strips empty sets/exercises out of a draft before saving. */
  function cleanDraftExercises(draftObj) {
    normalizeSupersets(draftObj.exercises);
    return draftObj.exercises.map(function (blk) {
      var metric = metricOf(blk);
      var out = {
        exerciseId: blk.exerciseId,
        metric: metric,
        sets: blk.sets.filter(function (s) {
          // a set counts if anything meaningful for its mode was entered
          if (metric === "distance") return s.distance != null || s.seconds != null;
          if (metric === "time") return s.seconds != null || s.weight != null;
          return s.reps != null || s.weight != null;
        })
      };
      if (blk.equipment) {
        out.equipment = blk.equipment;
        // bodyweight has no weight box, so don't carry a stale number through
        if (dropsWeight(blk, metric)) out.sets.forEach(function (s) { s.weight = null; });
      }
      if (blk.note && blk.note.trim()) out.note = blk.note.trim();
      if (blk.superset) out.superset = blk.superset;
      return out;
    }).filter(function (blk) { return blk.sets.length > 0; });
  }

  function renderLog() {
    document.getElementById("log-gym").innerHTML = gymOptionsHtml(draft.gymId);
    document.getElementById("log-date").value = draft.date;
    document.getElementById("log-start").value = draft.startTime;
    document.getElementById("log-end").value = draft.endTime || "";
    updateDurationReadout("log", draft);
    renderExerciseBlocks(document.getElementById("exercise-blocks"), draft, renderLog, null);
    wireLogEvents();
  }

  function wireLogEvents() {
    document.getElementById("log-gym").onchange = function (e) { draft.gymId = e.target.value; };
    document.getElementById("log-date").onchange = function (e) { draft.date = e.target.value; };
    document.getElementById("log-start").onchange = function (e) {
      draft.startTime = e.target.value; updateDurationReadout("log", draft);
    };
    document.getElementById("log-end").onchange = function (e) {
      draft.endTime = e.target.value; updateDurationReadout("log", draft);
    };

    document.getElementById("add-gym-btn").onclick = function () {
      openGymAdd(function (g) {
        draft.gymId = g.id;              // adding one from here checks you in
        renderLog();
        showToast('Added ' + gymLabel(g) + ' -- checked in.');
      });
    };

    document.getElementById("add-exercise-btn").onclick = function () {
      openExercisePicker(function (exObj) {
        draft.exercises.push(blockFromLastTime(exObj, null));
        renderLog();
      });
    };

    document.getElementById("save-workout-btn").onclick = function () {
      if (!draft.exercises.length) { showToast("Add at least one exercise first."); return; }
      var cleanExercises = cleanDraftExercises(draft);
      if (!cleanExercises.length) { showToast("Fill in at least one set."); return; }

      // Work out PRs against your history BEFORE this session joins it.
      var prs = detectPRs(cleanExercises, null);

      var titleInput = document.getElementById("log-title");
      var calInput = document.getElementById("log-calories");
      var cals = calInput.value === "" ? null : Number(calInput.value);
      var workout = {
        id: uid("wk"),
        userId: state.me.id,
        userName: state.me.name,
        gymId: draft.gymId || null,
        title: titleInput.value.trim() || null,
        performedAt: isoFromDateTime(draft.date, draft.startTime),
        endedAt: defaultEndIso(draft),
        calories: cals != null && !isNaN(cals) ? cals : null,
        exercises: cleanExercises
      };
      state.workouts.push(workout);
      persist();
      titleInput.value = "";
      calInput.value = "";
      resetDraft();
      activateTab("home");
      buzz(prs.length ? [18, 60, 18, 60, 40] : 18);
      openSessionSummary(workout, prs);
    };
  }

  var exercisePickerCallback = null;

  function openExercisePicker(onPick) {
    exercisePickerCallback = onPick;
    document.getElementById("exercise-search").value = "";
    renderExercisePickerList("");
    document.getElementById("exercise-modal-overlay").classList.add("open");
    document.getElementById("exercise-search").focus();
  }

  function closeExercisePicker() {
    document.getElementById("exercise-modal-overlay").classList.remove("open");
    exercisePickerCallback = null;
  }

  function pickExercise(exObj) {
    var cb = exercisePickerCallback;
    closeExercisePicker();
    if (cb) cb(exObj);
  }

  /* How often and how recently you've done each exercise -- the picker is
     ranked by your own history, not the alphabet. */
  function exerciseUsage() {
    var use = {};
    myWorkouts().forEach(function (wk) {
      var t = new Date(wk.performedAt).getTime();
      wk.exercises.forEach(function (blk) {
        var u = use[blk.exerciseId] || (use[blk.exerciseId] = { count: 0, last: 0 });
        u.count++;
        if (t > u.last) u.last = t;
      });
    });
    return use;
  }

  function renderExercisePickerList(query) {
    var q = query.trim().toLowerCase();
    var use = exerciseUsage();

    var matches = state.exercises
      .filter(function (e) { return e.name.toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) {
        var ua = use[a.id], ub = use[b.id];
        // ones you've done first, most recent at the top
        if (!!ua !== !!ub) return ua ? -1 : 1;
        if (ua && ub && ua.last !== ub.last) return ub.last - ua.last;
        // then a name that starts with what you typed
        if (q) {
          var sa = a.name.toLowerCase().indexOf(q) === 0, sb = b.name.toLowerCase().indexOf(q) === 0;
          if (sa !== sb) return sa ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    var exact = state.exercises.some(function (e) { return e.name.toLowerCase() === q; });
    var listEl = document.getElementById("exercise-modal-list");

    var html = "";
    // nothing typed yet, or typed something new -> offer to add it inline
    if (q && !exact) {
      html += '<button class="picker-row is-create" data-create-ex="1">' +
        '<span class="create-plus">+</span> Add &ldquo;' + esc(query.trim()) + '&rdquo;' +
        '<span class="picker-sub">New exercise, saved for next time</span></button>';
    }

    html += matches.map(function (e) {
      var u = use[e.id];
      var sub = u
        ? u.count + (u.count === 1 ? " session" : " sessions") + " &middot; last " + shortDate(new Date(u.last).toISOString())
        : "Not logged yet";
      return '<button class="picker-row" data-pick-ex="' + e.id + '">' + esc(e.name) +
        '<span class="picker-sub">' + sub + '</span></button>';
    }).join("");

    if (!matches.length && !q) html += '<div class="empty-state" style="padding:16px 0;">No exercises yet.</div>';
    listEl.innerHTML = html;

    listEl.querySelectorAll("[data-pick-ex]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        pickExercise(findExercise(btn.getAttribute("data-pick-ex")));
      });
    });
    var createBtn = listEl.querySelector("[data-create-ex]");
    if (createBtn) createBtn.addEventListener("click", function () { createExerciseFrom(query.trim()); });
  }

  /* Adds to your catalogue -- your "inventory" -- then picks it. */
  function createExerciseFrom(raw) {
    var name = titleCase(raw);
    if (!name) return;
    var existing = state.exercises.filter(function (e) {
      return e.name.toLowerCase() === name.toLowerCase();
    })[0];
    var exObj = existing || {
      id: uid("ex"),
      name: name,
      category: EXERCISE_CATEGORIES[name] || "other",
      metric: DEFAULT_METRIC[name] || "reps"
    };
    if (!existing) { state.exercises.push(exObj); persist(); }
    pickExercise(exObj);
  }

  document.getElementById("exercise-search").addEventListener("input", function (e) {
    renderExercisePickerList(e.target.value);
  });
  document.getElementById("exercise-modal-close").addEventListener("click", closeExercisePicker);
  document.getElementById("exercise-modal-overlay").addEventListener("click", function (e) {
    if (e.target.id === "exercise-modal-overlay") closeExercisePicker();
  });

  /* ----------------------------- progress ----------------------------- */

  var selectedExerciseId = null;

  function buildProgressSeries() {
    var mine = myWorkouts().slice()
      .sort(function (a, b) { return new Date(a.performedAt) - new Date(b.performedAt); });
    var byExercise = {};
    mine.forEach(function (wk) {
      wk.exercises.forEach(function (we) {
        var metric = metricOf(we);
        var best = bestValueIn(we.sets, metric);
        if (best == null) return;
        var exObj = findExercise(we.exerciseId);
        if (!exObj) return;
        var key = we.exerciseId + "|" + metric; // a lift re-measured is a new series
        if (!byExercise[key]) {
          byExercise[key] = {
            name: exObj.name, metric: metric,
            unit: metric === "time" ? "" : unitFor(we.sets, metric),
            points: []
          };
        }
        byExercise[key].points.push({ date: wk.performedAt, weight: best });
      });
    });
    return byExercise;
  }

  var progressQuery = "";

  function renderProgress() {
    var series = buildProgressSeries();
    var ids = Object.keys(series).sort(function (a, b) { return series[b].points.length - series[a].points.length; });
    var resultsEl = document.getElementById("progress-results");
    var bodyEl = document.getElementById("progress-body");

    if (!ids.length) {
      resultsEl.innerHTML = "";
      bodyEl.innerHTML = '<div class="empty-state">Log a workout with weights to start seeing progress here.</div>';
      return;
    }
    if (!selectedExerciseId || !series[selectedExerciseId]) selectedExerciseId = ids[0];

    /* Nothing typed shows the exercise you train most, not a wall of chips.
       The box is for getting to any of the others. */
    var q = progressQuery.trim().toLowerCase();
    if (!q) {
      resultsEl.innerHTML = "";
    } else {
      var hits = ids.filter(function (id) {
        return series[id].name.toLowerCase().indexOf(q) !== -1;
      });
      resultsEl.innerHTML = hits.length
        ? hits.map(function (id) {
            var n = series[id].points.length;
            return '<button class="picker-row' + (id === selectedExerciseId ? " is-current" : "") +
              '" data-ex-pick="' + id + '">' + esc(series[id].name) +
              '<span class="picker-sub">' + n + (n === 1 ? " session" : " sessions") +
              ' &middot; best ' + esc(formatValue(
                Math.max.apply(null, series[id].points.map(function (p) { return p.weight; })),
                series[id].metric, series[id].unit)) + '</span></button>';
          }).join("")
        : '<div class="empty-state" style="padding:14px 2px;">Nothing logged matches &ldquo;' +
            esc(progressQuery.trim()) + '&rdquo;.</div>';
      resultsEl.querySelectorAll("[data-ex-pick]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          selectedExerciseId = btn.getAttribute("data-ex-pick");
          progressQuery = "";
          document.getElementById("progress-search").value = "";
          renderProgress();
        });
      });
    }

    var s = series[selectedExerciseId];
    var best = Math.max.apply(null, s.points.map(function (p) { return p.weight; }));
    var latest = s.points[s.points.length - 1];
    var isPR = latest.weight === best;

    var html = '<div class="card progress-card">' +
      '<div class="stat-row"><h2>' + esc(s.name) + '</h2>' + (isPR ? '<span class="pr-badge">New PR</span>' : '') + '</div>' +
      '<div class="best-stat">Best logged: <span class="num">' + esc(formatValue(best, s.metric, s.unit)) + '</span></div>';

    if (s.points.length > 1) {
      html += '<div class="chart-wrap"><svg id="progress-svg" viewBox="0 0 320 170" style="width:100%;height:auto;overflow:visible"></svg><div id="chart-tooltip" hidden></div></div>';
    } else {
      html += '<div class="empty-state" style="padding:20px 4px;">Log this exercise once more to see a trend line.</div>';
    }

    html += '<div class="history-list">' + s.points.slice().reverse().slice(0, 6).map(function (p) {
      return '<div class="history-row"><span>' + shortDate(p.date) + '</span><span class="num">' +
        esc(formatValue(p.weight, s.metric, s.unit)) + '</span></div>';
    }).join("") + '</div></div>';

    bodyEl.innerHTML = html;
    if (s.points.length > 1) drawChart(s.points, s.unit, s.metric);
  }

  function drawChart(points, unit, metric) {
    var svg = document.getElementById("progress-svg");
    var W = 320, H = 170, padL = 8, padR = 8, padT = 22, padB = 24;
    var weights = points.map(function (p) { return p.weight; });
    var min = Math.min.apply(null, weights), max = Math.max.apply(null, weights);
    if (min === max) { min -= 5; max += 5; }
    var span = max - min;
    min -= span * 0.15; max += span * 0.15;

    function x(i) { return padL + (i / (points.length - 1)) * (W - padL - padR); }
    function y(v) { return padT + (1 - (v - min) / (max - min)) * (H - padT - padB); }

    var ns = "http://www.w3.org/2000/svg";
    function el(tag, attrs) {
      var n = document.createElementNS(ns, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }

    svg.innerHTML = "";

    // gridlines (recessive)
    [0, 0.5, 1].forEach(function (t) {
      var gy = padT + t * (H - padT - padB);
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: "var(--border)", "stroke-width": 1 }));
    });

    // area fill
    var gradId = "grad" + Math.random().toString(36).slice(2, 8);
    var defs = el("defs", {});
    var grad = el("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": "0.32" }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": "0" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    var linePts = points.map(function (p, i) { return x(i) + "," + y(p.weight); }).join(" ");
    var areaPts = linePts + " " + x(points.length - 1) + "," + y(min) + " " + x(0) + "," + y(min);
    svg.appendChild(el("polygon", { points: areaPts, fill: "url(#" + gradId + ")" }));
    svg.appendChild(el("polyline", { points: linePts, fill: "none", stroke: "var(--accent)", "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));

    points.forEach(function (p, i) {
      var isLast = i === points.length - 1;
      svg.appendChild(el("circle", { cx: x(i), cy: y(p.weight), r: isLast ? 5 : 3.5, fill: isLast ? "var(--accent)" : "var(--bg)", stroke: "var(--accent)", "stroke-width": 2 }));
      if (i === 0 || isLast) {
        var t = el("text", { x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : "end", fill: "var(--text-faint)", "font-size": "9", "font-family": "Roboto Mono, monospace" });
        t.textContent = shortDate(p.date);
        svg.appendChild(t);
      }
    });

    // direct label on the last point
    var lastLabel = el("text", { x: x(points.length - 1), y: y(points[points.length - 1].weight) - 11, "text-anchor": "end", fill: "var(--text)", "font-size": "11", "font-weight": "600", "font-family": "Roboto Mono, monospace" });
    lastLabel.textContent = formatValue(points[points.length - 1].weight, metric, unit);
    svg.appendChild(lastLabel);

    // touch/hover layer
    var tooltip = document.getElementById("chart-tooltip");
    var overlay = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
    svg.appendChild(overlay);

    function showAt(clientX) {
      var rect = svg.getBoundingClientRect();
      var relX = ((clientX - rect.left) / rect.width) * W;
      var idx = Math.round(((relX - padL) / (W - padL - padR)) * (points.length - 1));
      idx = Math.max(0, Math.min(points.length - 1, idx));
      var p = points[idx];
      var px = ((x(idx)) / W) * rect.width;
      var py = (y(p.weight) / H) * rect.height;
      tooltip.style.left = px + "px";
      tooltip.style.top = py + "px";
      tooltip.innerHTML = shortDate(p.date) + " &middot; <span class=\"num\">" + formatValue(p.weight, metric, unit) + "</span>";
      tooltip.hidden = false;
    }
    overlay.addEventListener("pointermove", function (e) { showAt(e.clientX); });
    overlay.addEventListener("pointerdown", function (e) { showAt(e.clientX); });
    overlay.addEventListener("pointerleave", function () { tooltip.hidden = true; });
  }

  /* ----------------------------- gyms ----------------------------- */

  /* What you train at a gym, most-logged first. Becomes a community stat
     again when other people are in the picture. */
  function gymExerciseBreakdown(gymId) {
    var counts = {};
    myWorkouts().filter(function (w) { return w.gymId === gymId; }).forEach(function (wk) {
      wk.exercises.forEach(function (we) {
        counts[we.exerciseId] = (counts[we.exerciseId] || 0) + 1;
      });
    });
    return Object.keys(counts).map(function (exId) {
      var exObj = findExercise(exId);
      return { name: exObj ? exObj.name : "Exercise", count: counts[exId] };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  function renderGyms() {
    var q = (document.getElementById("gym-search").value || "").toLowerCase();
    var list = state.gyms.filter(function (g) {
      return (g.name + " " + gymAddress(g)).toLowerCase().indexOf(q) !== -1;
    });
    var el = document.getElementById("gym-list");
    if (!list.length) { el.innerHTML = '<div class="empty-state">No gyms match "' + esc(q) + '".</div>'; return; }
    el.innerHTML = list.map(function (g) {
      var n = myWorkouts().filter(function (w) { return w.gymId === g.id; }).length;
      var sub = [gymAddress(g), n + (n === 1 ? " session" : " sessions")].filter(Boolean).join(" \u00b7 ");
      return '<div class="gym-row" data-gym="' + g.id + '">' +
        '<div><div class="gym-row-name">' + esc(g.name) + '</div>' +
        '<div class="gym-row-city">' + esc(sub) + '</div></div>' +
        '<span class="chevron">&rsaquo;</span></div>';
    }).join("");
    el.querySelectorAll("[data-gym]").forEach(function (row) {
      row.addEventListener("click", function () { openGymModal(row.getAttribute("data-gym")); });
    });
  }
  document.getElementById("gym-search").addEventListener("input", renderGyms);

  document.getElementById("gyms-add-btn").addEventListener("click", function () {
    openGymAdd(function (g) {
      renderGyms();
      showToast("Added " + gymLabel(g) + ".");
    });
  });

  /* ----------------------------- add a gym ----------------------------- */

  var gymAddDone = null;
  var gymEditing = null;      // the gym being changed, or null when adding

  function gymAddFields() {
    return {
      name: document.getElementById("gym-add-name"),
      street: document.getElementById("gym-add-street"),
      city: document.getElementById("gym-add-city"),
      state: document.getElementById("gym-add-state")
    };
  }

  /* Shows what the gym will be called before you commit to it, so the
     "Name - City, ST" shape is never a surprise. */
  function updateGymAddPreview() {
    var f = gymAddFields();
    var draftGym = {
      id: gymEditing ? gymEditing.id : null,
      name: titleCase(f.name.value) || "Name",
      street: titleCase(f.street.value),
      city: titleCase(f.city.value),
      state: f.state.value.trim().toUpperCase()
    };
    document.getElementById("gym-add-preview").innerHTML =
      "Saves as <strong>" + esc(gymLabel(draftGym)) + "</strong>";
  }

  /* One sheet for both jobs: with a gym it edits that one, without it adds
     a new one. Same fields, same preview, same validation. */
  function openGymAdd(onSaved, gym) {
    gymAddDone = onSaved;
    gymEditing = gym || null;
    var f = gymAddFields();
    f.name.value = gym ? gym.name : "";
    f.street.value = gym ? (gym.street || "") : "";
    f.city.value = gym ? (gym.city || "") : "";
    f.state.value = gym ? (gym.state || "") : "";

    document.getElementById("gym-add-title").textContent = gym ? "Edit gym" : "Add gym";
    document.getElementById("gym-add-save").textContent = gym ? "Save changes" : "Save gym";
    var remove = document.getElementById("gym-add-remove");
    remove.hidden = !gym;
    remove.textContent = "Remove gym";
    remove.classList.remove("is-armed");

    updateGymAddPreview();
    document.getElementById("gym-add-overlay").classList.add("open");
    if (!gym) f.name.focus();
  }

  function closeGymAdd() {
    document.getElementById("gym-add-overlay").classList.remove("open");
    gymAddDone = null;
    gymEditing = null;
  }

  (function wireGymAdd() {
    var f = gymAddFields();
    [f.name, f.street, f.city, f.state].forEach(function (input) {
      input.addEventListener("input", updateGymAddPreview);
    });
    // Letters only, two of them. maxlength would let a stray digit eat a
    // slot, so the trimming happens after the junk is thrown away.
    f.state.addEventListener("input", function (e) {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    });

    document.getElementById("gym-add-close").addEventListener("click", closeGymAdd);
    document.getElementById("gym-add-overlay").addEventListener("click", function (e) {
      if (e.target.id === "gym-add-overlay") closeGymAdd();
    });

    document.getElementById("gym-add-save").addEventListener("click", function () {
      var fields = {
        name: titleCase(f.name.value),
        street: titleCase(f.street.value),
        city: titleCase(f.city.value),
        state: f.state.value.trim().toUpperCase()
      };
      if (!fields.name) { showToast("Give the gym a name."); f.name.focus(); return; }

      var key = gymKey(fields);
      var clash = state.gyms.some(function (x) {
        return x !== gymEditing && gymKey(x) === key;
      });
      if (clash) { showToast("You already have that one."); return; }

      var g = gymEditing;
      if (g) {
        // edited in place, so every workout already checked in here follows
        g.name = fields.name;
        g.street = fields.street;
        g.city = fields.city;
        g.state = fields.state;
      } else {
        g = { id: uid("gym"), name: fields.name, street: fields.street,
              city: fields.city, state: fields.state, offerings: [] };
        state.gyms.push(g);
      }
      var wasEdit = !!gymEditing;
      persist();
      var done = gymAddDone;
      closeGymAdd();
      if (done) done(g, wasEdit);
    });

    document.getElementById("gym-add-remove").addEventListener("click", function () {
      var g = gymEditing;
      if (!g) return;
      var n = state.workouts.filter(function (w) { return w.gymId === g.id; }).length;
      openConfirm({
        title: "Remove " + g.name + "?",
        body: n
          ? n + (n === 1 ? " session loses its check-in" : " sessions lose their check-in") +
            ". The sessions themselves are kept."
          : "Nothing is checked in here yet.",
        confirmLabel: "Remove gym",
        onConfirm: function () {
          state.workouts.forEach(function (w) { if (w.gymId === g.id) w.gymId = null; });
          state.gyms = state.gyms.filter(function (x) { return x.id !== g.id; });
          if (draft.gymId === g.id) draft.gymId = "";
          if (editDraft && editDraft.gymId === g.id) editDraft.gymId = "";
          persist();
          closeGymAdd();
          document.getElementById("gym-modal-overlay").classList.remove("open");
          renderGyms();
          renderLog();
          renderHome();
          showToast("Removed " + g.name + ".");
        }
      });
    });
  })();

  document.getElementById("gym-modal-edit").addEventListener("click", function () {
    var g = findGym(openGymId);
    if (!g) return;
    openGymAdd(function (saved) {
      renderGyms();
      renderLog();
      renderHome();
      openGymModal(saved.id);          // reopen with the new details
      showToast("Updated " + gymLabel(saved) + ".");
    }, g);
  });

  var openGymId = null;

  function openGymModal(gymId) {
    openGymId = gymId;
    var g = findGym(gymId);
    var breakdown = gymExerciseBreakdown(gymId);
    var sessions = myWorkouts().filter(function (w) { return w.gymId === gymId; })
      .sort(function (a, b) { return new Date(b.performedAt) - new Date(a.performedAt); });
    var overlay = document.getElementById("gym-modal-overlay");
    overlay.querySelector("#gym-modal-name").textContent = g.name;
    overlay.querySelector("#gym-modal-city").textContent = gymAddress(g);

    overlay.querySelector("#gym-modal-summary").innerHTML = sessions.length
      ? '<div class="stat-grid two" style="margin:0 0 16px;">' +
          '<div class="stat-tile"><span class="num">' + sessions.length + '</span><span class="label">Sessions</span></div>' +
          '<div class="stat-tile"><span class="num">' + calendarDate(sessions[0].performedAt).split(",")[1].trim() +
            '</span><span class="label">Last visit</span></div>' +
        '</div>'
      : "";

    var offeringsEl = overlay.querySelector("#gym-modal-offerings");
    offeringsEl.innerHTML = g.offerings && g.offerings.length
      ? g.offerings.map(function (o) { return '<span class="offering-chip">' + esc(o) + '</span>'; }).join("")
      : "";

    var popEl = overlay.querySelector("#gym-modal-popular");
    popEl.innerHTML = breakdown.length
      ? breakdown.map(function (p, i) {
          return '<div class="popular-row"><span class="popular-rank">' + (i + 1) + '</span><div>' +
            '<div class="popular-name">' + esc(p.name) + '</div>' +
            '<div class="popular-sub">' + p.count + (p.count === 1 ? ' session' : ' sessions') + '</div></div></div>';
        }).join("")
      : '<div class="empty-state" style="padding:16px 0;">Nothing logged here yet.</div>';
    overlay.classList.add("open");
  }

  document.getElementById("gym-modal-close").addEventListener("click", function () {
    document.getElementById("gym-modal-overlay").classList.remove("open");
  });
  document.getElementById("gym-modal-overlay").addEventListener("click", function (e) {
    if (e.target.id === "gym-modal-overlay") e.currentTarget.classList.remove("open");
  });

  /* ----------------------------- home ----------------------------- */

  function renderHome() {
    var me = state.me;
    var mine = myWorkouts();
    var first = me.name.split(" ")[0];

    document.getElementById("home-greeting").textContent =
      me.name && me.name !== "You" ? first + "'s Training" : "Your Training";

    var streak = computeStreak(me.id);
    document.getElementById("profile-stats").innerHTML = [
      { label: "Workouts", value: mine.length },
      { label: "Gyms", value: gymsOf(me.id).length, action: "gyms" },
      { label: streakUnit(streak.mode) + " streak", value: streak.current, flame: true }
    ].map(function (s) {
      var tag = s.action ? "button" : "div";
      var num = s.flame
        ? '<span class="num is-streak">' +
            FLAME_SVG.replace("streak-flame", "streak-flame" + (s.value ? "" : " cold")) +
            s.value + '</span>'
        : '<span class="num">' + s.value + '</span>';
      return "<" + tag + ' class="stat-tile"' + (s.action ? ' data-stat="' + s.action + '"' : "") + '>' +
        num + '<span class="label">' + s.label + '</span></' + tag + '>';
    }).join("");

    renderGoalBar(me.id);

    document.querySelectorAll("#profile-stats [data-stat]").forEach(function (tile) {
      tile.addEventListener("click", function () { openGymsSheet(me.id); });
    });

    renderCalendar(me.id, true);
    renderHomeFriends();
  }

  /* A one-line version of the Friends page, under the calendar: enough to
     know whether anyone trained, and a way through to the rest. */
  function renderHomeFriends() {
    var el = document.getElementById("home-friends");
    var friends = friendsOf(state.me.id);
    var todayKey = localDayKey(new Date().toISOString());

    var trained = friends.filter(function (u) {
      return workoutsOf(u.id).some(function (wk) {
        return localDayKey(wk.performedAt) === todayKey;
      });
    });

    if (!friends.length) {
      el.innerHTML = '<span class="home-friends-line">Add friends to see who trained today</span>' +
        '<span class="chevron">&rsaquo;</span>';
      return;
    }

    el.innerHTML =
      '<span class="home-friends-faces">' +
        friends.slice(0, 5).map(function (u) {
          var on = trained.indexOf(u) !== -1;
          return '<span class="home-face' + (on ? " is-on" : "") + '">' + avatarHtml(u) + '</span>';
        }).join("") +
      '</span>' +
      '<span class="home-friends-line">' +
        (trained.length
          ? '<strong>' + trained.length + '</strong> of ' + friends.length + ' trained today'
          : 'Nobody has logged yet today') +
      '</span>' +
      '<span class="chevron">&rsaquo;</span>';
  }

  document.getElementById("home-friends").addEventListener("click", function () {
    activateTab("friends");
  });

  /* ----------------------------- profile ----------------------------- */

  /* Everything that is "you over time": who you are, the all-time numbers,
     your gyms and your whole history. Home stays about today. */
  function renderProfile() {
    var me = state.me;
    var mine = myWorkouts();
    var streak = computeStreak(me.id);
    var first = mine.slice().sort(function (a, b) {
      return new Date(a.performedAt) - new Date(b.performedAt);
    })[0];

    document.getElementById("profile-head").innerHTML =
      avatarHtml(me, "is-big") +
      '<div class="profile-name">' + esc(me.name) + '</div>' +
      '<div class="profile-actions">' +
        '<button class="btn btn-ghost" id="pick-photo">' +
          (me.avatar ? "Change photo" : "Add photo") + '</button>' +
        (me.avatar ? '<button class="btn btn-ghost" id="drop-photo">Remove</button>' : '') +
        '<button class="btn btn-ghost" id="rename-me">Rename</button>' +
      '</div>';

    document.getElementById("profile-alltime").innerHTML = [
      { value: mine.length, label: mine.length === 1 ? "Workout" : "Workouts" },
      { value: gymsOf(me.id).length, label: "Gyms" },
      { value: streak.best, label: "Best streak" },
      { value: first ? shortDate(first.performedAt) : "--", label: "First logged" }
    ].map(function (t) {
      return '<div class="stat-tile"><span class="num">' + esc(String(t.value)) +
        '</span><span class="label">' + esc(t.label) + '</span></div>';
    }).join("");

    var fileInput = document.getElementById("avatar-input");
    document.getElementById("pick-photo").addEventListener("click", function () { fileInput.click(); });
    var drop = document.getElementById("drop-photo");
    if (drop) {
      drop.addEventListener("click", function () {
        updateMe("avatar", null);
        renderProfile();
        renderHome();
      });
    }
    document.getElementById("rename-me").addEventListener("click", openRename);

    renderGyms();
    renderProfileWorkouts(mine, true);
  }

  /* The name is edited in a dialog rather than a live field: a text input
     that re-renders the screen on blur is how you tear it out mid-event. */
  function openRename() {
    var el = openListSheet("Display name",
      '<input type="text" id="rename-input" value="' + esc(state.me.name) + '" placeholder="Your name">' +
      '<p class="setting-help">Shown on your sessions, and to friends once accounts are in.</p>' +
      '<button class="btn btn-primary btn-block" id="rename-save">Save</button>');

    var input = el.querySelector("#rename-input");
    input.focus();
    el.querySelector("#rename-save").addEventListener("click", function () {
      var v = titleCase(input.value);
      if (!v) { showToast("Give yourself a name."); return; }
      updateMe("name", v);
      state.workouts.forEach(function (w) { if (w.userId === state.me.id) w.userName = v; });
      persist();
      closeListSheet();
      renderProfile();
      renderHome();
    });
  }


  function renderProfileWorkouts(theirWorkouts, isMe) {
    var query = (document.getElementById("profile-search").value || "").trim();
    var list = theirWorkouts.slice()
      .sort(function (a, b) { return new Date(b.performedAt) - new Date(a.performedAt); })
      .filter(function (wk) { return workoutMatches(wk, query); });

    document.getElementById("profile-count").textContent =
      query ? list.length + " of " + theirWorkouts.length : theirWorkouts.length + " total";

    var el = document.getElementById("profile-workouts");
    if (!list.length) {
      el.innerHTML = '<div class="empty-state">' + (query
        ? 'Nothing matches "' + esc(query) + '".'
        : (isMe ? "You haven't logged a workout yet -- head to the Log tab."
                : "No workouts logged yet.")) + '</div>';
      return;
    }

    // Group by month so a long history stays scannable.
    var html = "";
    var lastMonth = null;
    list.forEach(function (wk) {
      var key = monthKey(wk.performedAt);
      if (key !== lastMonth) {
        html += '<div class="month-head">' + monthLabel(wk.performedAt) + '</div>';
        lastMonth = key;
      }
      var d = new Date(wk.performedAt);
      var gymObj = wk.gymId ? findGym(wk.gymId) : null;
      var exCount = wk.exercises.length;
      html += '' +
        // Only your own entries open the editor when tapped.
        '<button class="log-row" data-open-row="' + wk.id + '">' +
          '<span class="log-date"><span class="log-day">' + d.getDate() + '</span><span class="log-mon">' + MONTHS[d.getMonth()].toUpperCase() + '</span></span>' +
          '<span class="log-body">' +
            '<span class="log-title" style="display:block;">' + esc(wk.title || "Workout") + '</span>' +
            '<span class="log-meta" style="display:block;">' +
              [esc(formatTime(wk.performedAt))]
                .concat(gymObj ? [esc(gymLabel(gymObj))] : [])
                .concat(sessionFacts(wk).map(esc))
                .concat([exCount + (exCount === 1 ? " exercise" : " exercises")])
                .join(' &middot; ') +
            '</span>' +
            '<span class="exercise-chips">' + exerciseChipsHtml(wk) + '</span>' +
          '</span>' +
        '</button>';
    });
    el.innerHTML = html;

    el.querySelectorAll("[data-open-row]").forEach(function (row) {
      row.addEventListener("click", function () { openWorkoutDetail(row.getAttribute("data-open-row")); });
    });
  }

  document.getElementById("profile-search").addEventListener("input", function () {
    // only the list, so the search box keeps focus while you type
    renderProfileWorkouts(myWorkouts(), true);
  });

  /* The storage warning matters once; after that it's clutter. */
  (function storageNote() {
    var note = document.getElementById("storage-note");
    var btn = document.getElementById("note-dismiss");
    if (!note || !btn) return;
    if (state.settings.hideStorageNote) note.hidden = true;
    btn.addEventListener("click", function () {
      note.hidden = true;
      state.settings.hideStorageNote = true;
      persist();
    });
  })();

  document.getElementById("progress-search").addEventListener("input", function (e) {
    progressQuery = e.target.value;
    renderProgress();
  });

  /* ----------------------------- the keyboard bar ----------------------------- */

  /* Typing 187.5 is slower than tapping +2.5. The bar rides above the
     keyboard on whichever weight field has focus, and the steps follow the
     unit, since 2.5kg is not a plate anyone owns. */
  var BUMPS = { lb: [2.5, 5, 10], kg: [1.25, 2.5, 5] };
  var bumpTarget = null;
  var kbCovered = 0;      // how much of the screen the keyboard is taking

  function bumpSteps() {
    var unit = "lb";
    if (bumpTarget) {
      var row = bumpTarget.closest(".set-row");
      var toggle = row && row.querySelector("[data-unit-toggle]");
      if (toggle && toggle.textContent.trim() === "kg") unit = "kg";
    }
    return BUMPS[unit];
  }

  function showKbBar(input) {
    bumpTarget = input;
    var steps = bumpSteps();
    var bar = document.getElementById("kb-bar");
    bar.querySelectorAll("[data-bump]").forEach(function (chip) {
      var i = Number(chip.getAttribute("data-bump"));
      chip.textContent = i < 0 ? "\u2212" + steps[0] : "+" + steps[i];
    });
    bar.hidden = false;
  }

  function hideKbBar() {
    document.getElementById("kb-bar").hidden = true;
    bumpTarget = null;
  }

  (function wireKbBar() {
    var bar = document.getElementById("kb-bar");

    document.addEventListener("focusin", function (e) {
      // only once a soft keyboard is actually up: on a laptop the bar would
      // just sit on top of the tab bar for no reason
      if (e.target.classList && e.target.classList.contains("set-v2")) {
        if (kbCovered > 80) showKbBar(e.target);
      } else if (!bar.contains(e.target)) hideKbBar();
    });
    document.addEventListener("focusout", function (e) {
      // a chip steals focus for an instant; let it finish before hiding
      setTimeout(function () {
        if (document.activeElement === e.target) return;
        if (!document.activeElement || !document.activeElement.classList ||
            !document.activeElement.classList.contains("set-v2")) hideKbBar();
      }, 120);
    });

    bar.addEventListener("mousedown", function (e) { e.preventDefault(); });
    bar.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });

    bar.querySelectorAll("[data-bump]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        if (!bumpTarget) return;
        var i = Number(chip.getAttribute("data-bump"));
        var steps = bumpSteps();
        var delta = i < 0 ? -steps[0] : steps[i];
        var now = parseFloat(bumpTarget.value);
        var next = Math.max(0, (isNaN(now) ? 0 : now) + delta);
        bumpTarget.value = Math.round(next * 100) / 100;
        bumpTarget.dispatchEvent(new Event("input", { bubbles: true }));
        buzz(8);
      });
    });

    document.getElementById("kb-done").addEventListener("click", function () {
      if (bumpTarget) bumpTarget.blur();
      hideKbBar();
    });
  })();

  /* ----------------------------- theme ----------------------------- */

  /* Light is the default and matches MyFitnessPal. Dark is the same layout on
     a dark surface -- one attribute on <html> swaps every colour, because the
     stylesheet only ever names variables. */
  var THEME_BAR = { light: "#f4f6f8", dark: "#12151a" };

  function applyTheme() {
    var t = state.settings.theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_BAR[t]);
  }

  /* ----------------------------- keyboard ----------------------------- */

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
        document.body.classList.remove("kb-open");
        return;
      }
      var covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      frame.style.bottom = covered + "px";
      // modals sit outside the frame, so they read the same number from here
      document.documentElement.style.setProperty("--kb", covered + "px");
      kbCovered = covered;
      // the keyboard often arrives after the focus event, so catch it here too
      var focused = document.activeElement;
      if (covered > 80 && focused && focused.classList &&
          focused.classList.contains("set-v2")) showKbBar(focused);
      else if (!covered) hideKbBar();
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

  /* ----------------------------- boot ----------------------------- */

  applyTheme();
  if (restoreDraft()) {
    renderLog();
    showToast("Picked your workout back up.");
  }
  persist();
  renderHome();
})();
