import {
  loadState, saveState, cloudEnabled, currentUser, startSync, syncNow, syncStatus,
  signIn, signUp, signOut, newId, shrinkPhoto, photoSrc,
  refreshSocial, searchPeople, sendFriendRequest, acceptFriendRequest, declineFriendRequest,
  cancelFriendRequest, removeFriend, setReaction, setUsername, USERNAME_RULE, usesUsernameLogin,
  pushSupport, pushPermission, pushEnabled, enablePush, disablePush
} from "./store.js";

(function () {
  "use strict";

  /* New key: a clean break from the demo data. Nothing from the seeded
     preview carries over. */
  var STORAGE_KEY = "gymsocial_v1";

  /* ----------------------------- starting state ----------------------------- */

  /* Real uuids, so anything made here can go straight into the database.
     (The prefix is kept for readability at the call sites only.) */
  function uid(prefix) { return newId(); }

  /* Movement pattern per exercise -- drives the calendar colors. */
  /* How a set is measured. An exercise picks one; every screen that reads
     sets asks here rather than assuming reps-and-weight. */
  var METRICS = {
    reps:     { label: "Reps",     col1: "Reps",  col2: "Weight",   unitKey: "unit",     units: ["lb", "kg"] },
    time:     { label: "Time",     col1: "Time",  col2: "Weight",   unitKey: "unit",     units: ["lb", "kg"] },
    distance: { label: "Distance", col1: "Time",  col2: "Distance", unitKey: "distUnit", units: ["mi", "km"] },
    // a run, a ride, a row: one entry with its own fields (see CARDIO below)
    cardio:   { label: "Cardio",   col1: "Time",  col2: "Distance", unitKey: "distUnit", units: ["mi", "km", "m"] }
  };

  /* ---- cardio: what each activity asks for ----
     dist: the units its distance can be in (null = no distance at all)
     rate: what's worked out from time + distance -- pace (min per mile),
           speed (mph) or split (per 500m, for rowing)
     intensity: the machine setting worth writing down, if any */
  var CARDIO_BUILTIN = ["Run", "Walk", "Hike", "Bike", "Spin", "Row", "Elliptical", "Stair Climber"];
  var CARDIO_PROFILES = {
    "Run":           { icon: "\uD83C\uDFC3", dist: ["mi", "km"], rate: "pace",  intensity: "Incline %",  steps: true },
    "Walk":          { icon: "\uD83D\uDEB6", dist: ["mi", "km"], rate: "pace",  intensity: "Incline %",  steps: true },
    "Hike":          { icon: "\uD83E\uDD7E", dist: ["mi", "km"], rate: "pace",  intensity: null,         steps: true },
    "Bike":          { icon: "\uD83D\uDEB4", dist: ["mi", "km"], rate: "speed", intensity: "Resistance", steps: false },
    "Spin":          { icon: "\uD83D\uDEB4", dist: ["mi", "km"], rate: "speed", intensity: "Resistance", steps: false },
    "Row":           { icon: "\uD83D\uDEA3", dist: ["m"],        rate: "split", intensity: "Damper",     steps: false },
    "Elliptical":    { icon: "\u26A1",       dist: ["mi", "km"], rate: null,    intensity: "Level",      steps: true },
    "Stair Climber": { icon: "\uD83E\uDE9C", dist: null,         rate: null,    intensity: "Level",      steps: true }
  };
  var CARDIO_GENERIC = { icon: "\u26A1", dist: ["mi", "km"], rate: null, intensity: "Level", steps: true };

  function activityProfile(name) {
    return CARDIO_PROFILES[name] || CARDIO_GENERIC;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // 8:13 /mi, 7.3 mph, 2:05 /500m -- or "" when there isn't enough to say
  function cardioRate(st, profile) {
    if (!st || !st.seconds || !st.distance || !profile.rate) return "";
    var unit = st.distUnit || (profile.dist && profile.dist[0]) || "mi";
    if (profile.rate === "speed") {
      var v = st.distance / (st.seconds / 3600);
      return (Math.round(v * 10) / 10) + (unit === "km" ? " km/h" : " mph");
    }
    var per = profile.rate === "split" ? st.seconds / (st.distance / 500) : st.seconds / st.distance;
    per = Math.round(per);
    return Math.floor(per / 60) + ":" + pad2(per % 60) + (profile.rate === "split" ? " /500m" : " /" + unit);
  }

  function cardioDistanceText(st) {
    if (st.distance == null) return "";
    var unit = st.distUnit || "mi";
    return (unit === "m" ? Math.round(st.distance).toLocaleString() : Math.round(st.distance * 100) / 100) + " " + unit;
  }

  // "3.1 mi · 25:30 · 8:13 /mi", with the extras when asked for
  function cardioSummary(st, name, full) {
    if (!st) return "";
    var prof = activityProfile(name);
    var parts = [cardioDistanceText(st), st.seconds ? formatDuration(st.seconds) : "", cardioRate(st, prof)];
    if (full) {
      if (st.intensity != null && prof.intensity) parts.push(prof.intensity.replace(" %", "") + " " + st.intensity + (prof.intensity.indexOf("%") !== -1 ? "%" : ""));
      if (st.heartRate != null) parts.push(st.heartRate + " bpm");
      if (st.steps != null) parts.push(Number(st.steps).toLocaleString() + " steps");
    }
    return parts.filter(Boolean).join(" \u00b7 ") || "\u2014";
  }

  /* A cardio post's headline numbers: distance, time, pace, then whatever
     else was recorded. */
  function cardioTiles(wk) {
    var blk = wk.exercises[0], st = blk.sets[0] || {};
    var ex = findExercise(blk.exerciseId);
    var prof = activityProfile(ex ? ex.name : "");
    var t = [];
    if (st.distance != null) t.push({ value: cardioDistanceText(st).split(" ")[0], label: "Distance " + (st.distUnit || "mi") });
    var secs = st.seconds || durationOf(wk);
    if (secs) t.push({ value: formatDuration(secs), label: "Time" });
    var rate = cardioRate(st, prof);
    if (rate) {
      var bits = rate.split(" ");
      t.push({ value: bits[0], label: ({ pace: "Avg pace ", speed: "Avg speed ", split: "Avg split " }[prof.rate]) + bits.slice(1).join(" ") });
    }
    if (st.heartRate != null) t.push({ value: st.heartRate, label: "Avg bpm" });
    if (st.steps != null) t.push({ value: Number(st.steps).toLocaleString(), label: "Steps" });
    if (st.intensity != null && prof.intensity) t.push({ value: st.intensity, label: prof.intensity });
    if (wk.calories != null) t.push({ value: wk.calories, label: "Calories" });
    return t;
  }

  function isCardioWorkout(wk) {
    return !!(wk && wk.exercises && wk.exercises.length &&
      wk.exercises.every(function (b) { return b.metric === "cardio"; }));
  }

  function cardioIconFor(wk) {
    var ex = wk && wk.exercises[0] && findExercise(wk.exercises[0].exerciseId);
    return activityProfile(ex ? ex.name : "").icon;
  }

  // a cardio post reads "🏃 Run" in lists
  function workoutTitleHtml(wk) {
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

  function weightLabel(blk) {
    return WEIGHT_MODES[weightMode(blk && blk.equipment)].label;
  }

  function isCustomEquipment(name) {
    return BUILTIN_EQUIPMENT.indexOf(name) === -1;
  }

  /* Reps and holds are loaded with something -- a weighted plank is the whole
     reason Time needs it too. A run is not, so Distance still has no rail. */
  function usesEquipment(metric) { return metric !== "distance"; }

  /* Only "No weight" drops the column. Bodyweight keeps it (empty unless you
     hung a plate off yourself); a run never had one. */
  function dropsWeight(blk, metric) {
    return metric !== "distance" && !!blk && weightMode(blk.equipment) === "none";
  }

  /* Per hand and per side are half the load: 50s in each hand moved 100. */
  function loadMultiplier(equipment) {
    var m = weightMode(equipment);
    return m === "perHand" || m === "perSide" ? 2 : 1;
  }

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

  function usesDuration(metric) { return metric === "time" || metric === "distance" || metric === "cardio"; }

  /* The number a set is judged by, in its own mode. */
  function setValue(s, metric) {
    if (metric === "cardio") return s.distance != null ? s.distance : s.seconds;
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
    if (metric === "cardio") {
      var d = sets.filter(function (s) { return s.distance != null; })[0];
      return d ? (d.distUnit || "mi") : "";
    }
    var key = METRICS[metric].unitKey;
    var withUnit = sets.filter(function (s) { return s[key]; })[0];
    return withUnit ? withUnit[key] : METRICS[metric].units[0];
  }

  function formatValue(v, metric, unit) {
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

  /* Four is enough to say something without turning into a keyboard. */
  var REACTIONS = ["\uD83D\uDCAA", "\uD83D\uDD25", "\uD83D\uDC4F", "\uD83D\uDE4C"];

  /* No equipment in the names: that's picked on the rail, and each one
     starts on what it's usually done with until you've logged it yourself. */
  var SEED_EXERCISE_NAMES = [
    "Bench Press", "Incline Press", "Back Squat", "Deadlift",
    "Romanian Deadlift", "Overhead Press", "Pull-Up", "Bent-Over Row",
    "Bicep Curl", "Tricep Pushdown", "Lateral Raise", "Lat Pulldown",
    "Leg Press", "Plank"
  ];

  var DEFAULT_EQUIPMENT = {
    "Bench Press": "Barbell", "Incline Press": "Dumbbell", "Back Squat": "Barbell",
    "Deadlift": "Barbell", "Romanian Deadlift": "Barbell", "Overhead Press": "Barbell",
    "Pull-Up": "Bodyweight", "Bent-Over Row": "Barbell", "Bicep Curl": "Dumbbell",
    "Tricep Pushdown": "Cable", "Lateral Raise": "Dumbbell", "Lat Pulldown": "Cable",
    "Leg Press": "Machine", "Plank": "Bodyweight"
  };

  var EXERCISE_CATEGORIES = {
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
  function seedState() {
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
    if (currentUser()) {
      setReaction(wk.id, had !== emoji ? emoji : null).catch(function () {
        showToast("Couldn't save your reaction. Check your connection.");
      });
    }
  }

  /* ---- any single emoji ----
     One emoji as a person sees it can be many characters underneath (a flag
     is two, a family is seven), so "one" is counted in graphemes. The
     pattern is built at run time: an older browser that can't parse it
     falls back to a rougher check instead of failing to load the app. */
  var EMOJI_RE = null;
  try {
    EMOJI_RE = new RegExp("^(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|" +
      "\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}|[\\u{E0020}-\\u{E007F}])*" +
      "(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})*)*)$", "u");
  } catch (e) { /* no Unicode property support */ }

  /* The emoji if `raw` is exactly one, otherwise null. */
  function oneEmoji(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || s.length > 32) return null;
    if (window.Intl && Intl.Segmenter) {
      var n = 0;
      var it = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)[Symbol.iterator]();
      while (!it.next().done) n++;
      if (n !== 1) return null;
    }
    if (EMOJI_RE) return EMOJI_RE.test(s) ? s : null;
    // rough: no letters or digits, and short enough to be one symbol
    return /[a-z0-9\s]/i.test(s) || Array.from(s).length > 8 ? null : s;
  }

  /* The quick four, then whatever else people used on this workout.
     Anything from the server that isn't a single emoji is never drawn. */
  function reactionOrder(wk) {
    var all = reactionsOf(wk);
    return REACTIONS.concat(Object.keys(all).filter(function (e) {
      return REACTIONS.indexOf(e) === -1 && all[e].length && oneEmoji(e);
    }));
  }

  /* The + is a text box dressed as a chip: tapping it brings up the keyboard
     with no script involved (iPhone only opens it from a real tap), and
     nothing is swapped in or out, so the row never shifts under a finger. */
  function reactionBarHtml(wk) {
    return '<div class="react-bar">' + reactionOrder(wk).map(function (e) {
      var n = reactionCount(wk, e);
      if (!n && REACTIONS.indexOf(e) === -1) return '';
      return '<button class="react' + (iReacted(wk, e) ? " is-mine" : "") +
        '" data-react="' + esc(wk.id) + '|' + esc(e) + '">' + esc(e) +
        (n ? '<span class="react-n">' + n + '</span>' : '') + '</button>';
    }).join("") +
      '<input class="react react-add" data-react-add="' + esc(wk.id) + '" type="text" placeholder="+" ' +
        'aria-label="React with any emoji" autocomplete="off" autocorrect="off" autocapitalize="off" ' +
        'spellcheck="false" enterkeyhint="done">' +
    '</div>';
  }

  /* Who reacted to one of yours, and with what -- newest friends first
     isn't knowable, so it's grouped by reaction in the bar's order. */
  function reactorsHtml(wk) {
    var all = reactionsOf(wk);
    var rows = [];
    reactionOrder(wk).forEach(function (e) {
      (all[e] || []).forEach(function (uid) {
        var u = findPerson(uid) || { id: uid, name: "Someone" };
        rows.push('<div class="reactor-row" data-profile="' + esc(uid) + '">' + avatarHtml(u) +
          '<span class="person-name">' + esc(u.name) +
            (u.handle ? '<span class="reactor-handle">@' + esc(u.handle) + '</span>' : '') + '</span>' +
          '<span class="reactor-emoji">' + esc(e) + '</span></div>');
      });
    });
    if (!rows.length) return '';
    return '<div class="reactors"><div class="manage-head">Reactions (' + rows.length + ')</div>' +
      rows.join("") + '</div>';
  }

  /* Under your own workout on Home: each reaction you got, with a count.
     Not buttons -- you don't react to yourself; tap the workout for names. */
  function receivedReactionsHtml(wk) {
    var all = reactionsOf(wk);
    var chips = reactionOrder(wk).filter(function (e) { return (all[e] || []).length; }).map(function (e) {
      return '<span class="react is-static">' + esc(e) + '<span class="react-n">' + all[e].length + '</span></span>';
    });
    return chips.length ? '<div class="react-bar">' + chips.join("") + '</div>' : '';
  }

  /* A line on your own cards in History: who reacted, at a glance. */
  function reactionSummaryHtml(wk) {
    var all = reactionsOf(wk);
    var n = 0, shown = [];
    reactionOrder(wk).forEach(function (e) {
      if ((all[e] || []).length) { n += all[e].length; shown.push(e); }
    });
    return n ? '<span class="react-summary">' + esc(shown.slice(0, 5).join("")) + ' ' + n + '</span>' : '';
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

    root.querySelectorAll("[data-react-add]").forEach(function (box) {
      box.addEventListener("click", function (e) { e.stopPropagation(); });
      box.addEventListener("keydown", function (e) { if (e.key === "Enter") box.blur(); });
      box.addEventListener("blur", function () { box.value = ""; });
      box.addEventListener("input", function (e) {
        if (e.isComposing || !box.value.trim()) return;
        var emoji = oneEmoji(box.value);
        box.value = "";
        if (!emoji) { showToast("Pick one emoji, like 🎉"); return; }
        var id = box.getAttribute("data-react-add");
        var wk = state.workouts.filter(function (w) { return w.id === id; })[0];
        if (!wk) return;
        // typing the one you already chose leaves it on rather than clearing it
        if (myReaction(wk) !== emoji) toggleReaction(wk, emoji);
        box.blur();
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

  /* Your catalogue first; then names pulled in for friends' workouts, which
     are kept apart so they never appear in your own pickers. */
  function findExercise(id) {
    var byId = function (e) { return e.id === id; };
    return state.exercises.filter(byId)[0] || (state.foreignExercises || []).filter(byId)[0];
  }
  function findGym(id) {
    var byId = function (g) { return g.id === id; };
    return state.gyms.filter(byId)[0] || (state.foreignGyms || []).filter(byId)[0];
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

  /* Anyone we have a name for: friends first, then people who turned up in
     the Inbox or a search without being friends. */
  function findPerson(id) {
    return findUser(id) ||
      (state.inboxPeople || []).filter(function (u) { return u.id === id; })[0] ||
      knownPeople[id];
  }

  /* ----------------------------- your data ----------------------------- */

  /* Personal app: every query is scoped to you. The multi-user helpers that
     used to live here come back with the social layer. */
  function workoutsOf(userId) {
    return state.workouts.filter(function (w) { return w.userId === userId; });
  }

  function myWorkouts() { return workoutsOf(state.me.id); }

  /* One-way: whose sessions reach your home screen. Mutual connections, which
     are what unlock a private log, arrive with real accounts. */
  /* Signed out, there is nobody to show: friends are accounts. */
  function signedOut() { return cloudEnabled() && !currentUser(); }

  function friendsOf(userId) {
    if (signedOut()) return [];
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
  function lastSessionFor(exerciseId, excludeWorkoutId, equipment) {
    var found = null;
    myWorkouts().forEach(function (wk) {
      if (excludeWorkoutId && wk.id === excludeWorkoutId) return;
      var blk = wk.exercises.filter(function (we) {
        if (we.exerciseId !== exerciseId) return false;
        // asked for a particular equipment: curls on a cable aren't a guide for dumbbells
        return equipment === undefined || (we.equipment || null) === (equipment || null);
      })[0];
      if (!blk) return;
      if (!found || new Date(wk.performedAt) > new Date(found.workout.performedAt)) {
        found = { workout: wk, block: blk };
      }
    });
    return found;
  }

  /* "3x8 @ 135lb", "3x45s", "2.0 mi in 18:30" -- collapses identical sets. */
  function summarizeSets(sets, metric, equipment, name) {
    metric = metric || "reps";
    if (metric === "cardio") return cardioSummary(sets[0], name, true);
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
  function detectPRs(exerciseBlocks, excludeWorkoutId) {
    var prs = [];
    exerciseBlocks.forEach(function (blk) {
      var metric = metricOf(blk);
      if (metric === "cardio") return;      // a run isn't a lift record
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

  var FRIENDS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8"/><path d="M17.5 14.2a5.5 5.5 0 0 1 3 4.8"/></svg>';
  // a heartbeat line: marks a cardio day on the calendar, where lifting gets a flame
  var CARDIO_MARK_SVG = '<svg class="cal-flame cal-cardio" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>';
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
        accountBlockHtml() +
        notifyBlockHtml() +
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

        /* Anything that can overwrite or wipe your log lives down here, away
           from the everyday settings, so it is never a stray tap away. */
        '<div class="settings-data">' +
          '<button class="settings-row" id="open-data">' +
            '<span class="settings-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/></svg></span>' +
            '<span class="person-body"><span class="person-name">Data</span>' +
              '<span class="person-sub">Back up, restore or erase</span></span>' +
            '<span class="chevron">&rsaquo;</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    wireAccount(el);
    wireNotify(el);
    el.querySelector("#open-data").addEventListener("click", openDataSheet);

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

  /* ----------------------------- notifications ----------------------------- */

  /* One switch. On an iPhone it only works from the Home Screen app, so in
     Safari it explains how to get there instead of failing quietly. */
  function notifyBlockHtml() {
    if (!cloudEnabled() || !currentUser()) return "";
    var support = pushSupport();
    var denied = pushPermission() === "denied";
    var help = support === "needs-install"
      ? 'Notifications only work in the Home Screen app. In Safari tap <strong>Share</strong> \u2192 ' +
        '<strong>Add to Home Screen</strong>, then open GymSocial from your Home Screen and turn this on.'
      : support === "unsupported"
        ? "This browser can't receive notifications."
        : denied
          ? 'Notifications are blocked for GymSocial. Turn them back on in iPhone ' +
            '<strong>Settings \u2192 Notifications \u2192 GymSocial</strong>.'
          : "When friends log a workout, react to yours, or send you a friend request.";
    var usable = support === "ok" && !denied;
    return '<div class="setting-block">' +
      '<div class="switch-row">' +
        '<label class="field-label" for="notify-switch" style="margin:0;">Notifications</label>' +
        '<button class="switch" id="notify-switch" role="switch" aria-checked="false"' +
          (usable ? '' : ' disabled') + '><span></span></button>' +
      '</div>' +
      '<p class="setting-help" id="notify-help">' + help + '</p>' +
    '</div>';
  }

  /* Right after a save is when a nudge makes sense: you just logged, and
     notifications are how you'd hear that a friend did. Asked at most once
     a week, and never once they're on, blocked, or impossible here. */
  var NOTIFY_ASK_KEY = "gymsocial_notify_asked";

  function maybeAskNotifications() {
    if (!cloudEnabled() || !currentUser()) return;
    if (pushSupport() !== "ok" || pushPermission() === "denied") return;
    var last = 0;
    try { last = Number(localStorage.getItem(NOTIFY_ASK_KEY)) || 0; } catch (e) { return; }
    if (Date.now() - last < 7 * 24 * 3600 * 1000) return;
    pushEnabled().then(function (on) {
      if (on) return;
      try { localStorage.setItem(NOTIFY_ASK_KEY, String(Date.now())); } catch (e) { /* ask again later */ }
      setTimeout(function () {
        openConfirm({
          title: "Want notifications?",
          body: "Get a heads-up when your friends log a workout or react to yours.",
          confirmLabel: "Yes, turn on",
          cancelLabel: "Not now",
          danger: false,
          // straight from the tap: iPhone only shows the permission prompt then
          onConfirm: function () {
            enablePush()
              .then(function () { showToast("Notifications on."); })
              .catch(function (err) {
                var m = err && err.message;
                if (m === "denied") showToast("Notifications are blocked. Turn them on in iPhone Settings.");
                else if (m !== "dismissed") showToast(m || "Couldn't turn on notifications.");
              });
          }
        });
      }, 600);
    }).catch(function () { /* not worth bothering anyone over */ });
  }

  function wireNotify(el) {
    var sw = el.querySelector("#notify-switch");
    if (!sw) return;
    var set = function (on) { sw.setAttribute("aria-checked", on ? "true" : "false"); };
    if (!sw.disabled) pushEnabled().then(set).catch(function () { set(false); });

    sw.addEventListener("click", function () {
      var turningOn = sw.getAttribute("aria-checked") !== "true";
      sw.disabled = true;
      // enablePush asks for permission first thing: iOS only allows that
      // straight from a tap, so nothing async may come before it
      (turningOn ? enablePush() : disablePush())
        .then(function () {
          set(turningOn);
          showToast(turningOn ? "Notifications on." : "Notifications off.");
        })
        .catch(function (err) {
          var m = err && err.message;
          if (m === "denied") renderSettings();     // swaps in the "blocked" help
          else if (m === "dismissed") showToast("Notifications stay off.");
          else showToast(m || "Couldn't change notifications.");
        })
        .then(function () { if (document.body.contains(sw)) sw.disabled = false; });
    });
  }

  /* Tapping a notification opens the app at ?workout=<id> or ?friends=1, or,
     if it was already open, the service worker posts that same URL here.
     ?friends=1 is a friend request, and those are answered in the Inbox. */
  var pendingWorkout = null;
  var pendingInbox = false;     // asked for before we knew who's signed in

  function openFromUrl(href) {
    var params = new URL(href, location.href).searchParams;
    var wid = params.get("workout");
    var add = params.get("add");
    if (add) {
      pendingAdd = String(add).toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_.]/g, "");
      if (location.search) history.replaceState(null, "", location.pathname);
      processPendingAdd();
      return;
    }
    if (params.get("friends") || params.get("inbox")) {
      activateTab("friends");
      if (authResolved) openInbox(); else pendingInbox = true;
    } else if (wid) {
      activateTab("friends");
      if (state.workouts.some(function (w) { return w.id === wid; })) openWorkoutDetail(wid);
      else { pendingWorkout = wid; refreshSocial(true); }   // a friend's, not here yet
    }
    if (location.search) history.replaceState(null, "", location.pathname);
  }

  /* ----------------------------- account ----------------------------- */

  function syncLine() {
    var st = syncStatus();
    if (st.status === "syncing") return "Syncing\u2026";
    if (st.status === "offline") return "Offline \u2014 changes will sync when you're back online.";
    if (st.status === "error") return "Couldn't sync. Tap Sync now to try again.";
    if (st.status === "synced" && st.lastSynced) {
      var mins = Math.round((Date.now() - st.lastSynced) / 60000);
      return "Synced " + (mins < 1 ? "just now" : mins + " min ago") + ".";
    }
    return "";
  }

  function accountBlockHtml() {
    if (!cloudEnabled()) return "";
    var user = currentUser();
    if (user) {
      return '<div class="setting-block">' +
        '<label class="field-label">Account</label>' +
        '<div class="account-row">' +
          '<span class="account-label">Signed in as</span>' +
          '<strong class="account-value">@' + esc(state.me.handle || "") + '</strong>' +
          '<button class="account-edit" id="account-username">Change</button>' +
        '</div>' +
        '<div class="account-row">' +
          '<span class="account-label">Display name</span>' +
          '<strong class="account-value">' +
            (state.me.name && state.me.name !== "You" ? esc(state.me.name) : '<span class="is-unset">Not set</span>') +
          '</strong>' +
          '<button class="account-edit" id="account-name">Change</button>' +
        '</div>' +
        '<p class="setting-help" id="sync-line" style="margin-top:4px;">' + esc(syncLine()) + '</p>' +
        '<div class="action-row" style="margin-bottom:0;">' +
          '<button class="btn btn-ghost" id="sync-now-btn">Sync now</button>' +
          '<button class="btn btn-ghost" id="sign-out-btn">Sign out</button>' +
        '</div>' +
      '</div>';
    }
    return '<div class="setting-block">' +
      '<label class="field-label">Account</label>' +
      '<p class="setting-help" style="margin-top:0;">Sign in to back up your workouts, use them on any phone, and see your friends.</p>' +
      '<div class="action-row" style="margin-bottom:0;">' +
        '<button class="btn btn-primary" data-open-auth="signin">Sign in</button>' +
        '<button class="btn btn-ghost" data-open-auth="signup">Create account</button>' +
      '</div>' +
    '</div>';
  }

  /* ----------------------------- sign-in page ----------------------------- */

  /* A full screen of its own rather than a form in Settings: it is the first
     thing a friend sees when you send them the link. */
  var authMode = "signin";

  function setAuthMode(mode) {
    authMode = mode;
    var up = mode === "signup";
    document.getElementById("auth-title").textContent = up ? "Create your account" : "Welcome back";
    document.getElementById("auth-sub").textContent = up
      ? "Log your workouts and see when your friends train."
      : "Sign in to see your friends and sync your workouts.";
    document.getElementById("auth-submit").textContent = up ? "Create account" : "Sign in";
    document.getElementById("auth-password").setAttribute("autocomplete", up ? "new-password" : "current-password");
    document.getElementById("auth-switch").innerHTML = up
      ? 'Already have an account? <button type="button" data-auth-mode="signin">Sign in</button>'
      : 'New to GymSocial? <button type="button" data-auth-mode="signup">Create an account</button>';
    document.querySelectorAll(".auth-tabs [data-auth-mode]").forEach(function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-auth-mode") === mode);
    });
    authNote("");
  }

  function authNote(text, ok) {
    var n = document.getElementById("auth-note");
    n.textContent = text;
    n.classList.toggle("is-ok", !!ok);
  }

  function openAuth(mode) {
    setAuthMode(mode || "signin");
    document.getElementById("auth-page").hidden = false;
    document.body.classList.add("auth-open");
  }

  function closeAuth() {
    document.getElementById("auth-page").hidden = true;
    document.body.classList.remove("auth-open");
    document.getElementById("auth-password").value = "";
  }

  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-open-auth]");
    if (opener) { openAuth(opener.getAttribute("data-open-auth")); return; }
    var switcher = e.target.closest("#auth-page [data-auth-mode]");
    if (switcher) setAuthMode(switcher.getAttribute("data-auth-mode"));
  });

  document.getElementById("auth-close").addEventListener("click", closeAuth);

  document.getElementById("auth-show").addEventListener("click", function () {
    var pw = document.getElementById("auth-password");
    var show = pw.type === "password";
    pw.type = show ? "text" : "password";
    this.textContent = show ? "Hide" : "Show";
  });

  document.getElementById("auth-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = document.getElementById("auth-email").value.trim().toLowerCase();
    var pw = document.getElementById("auth-password").value;
    var btn = document.getElementById("auth-submit");
    if (!email || !pw) { authNote("Enter your username and a password."); return; }
    if (authMode === "signup" && !USERNAME_RULE.test(email.replace(/^@/, ""))) {
      authNote("Usernames are 3\u201320 lowercase letters, numbers, _ or .");
      return;
    }
    if (authMode === "signup" && pw.length < 6) { authNote("Use at least 6 characters for your password."); return; }
    btn.disabled = true;
    authNote("");
    var done = function () { btn.disabled = false; };

    if (authMode === "signin") {
      signIn(email, pw)
        .then(function () {
          done();
          closeAuth();
          showToast("Signed in. Syncing your workouts.");
          activateTab(currentTab === "settings" ? "settings" : currentTab);
        })
        .catch(function (err) { done(); authNote(err.message || "Couldn't sign in."); });
    } else {
      signUp(email, pw)
        .then(function (needsConfirm) {
          done();
          if (needsConfirm) {
            setAuthMode("signin");
            authNote("Account made, but Supabase still wants email confirmation. Turn off \u201cConfirm email\u201d in its settings.");
          } else {
            closeAuth();
            showToast("Account created. Syncing your workouts.");
            activateTab(currentTab);
          }
        })
        .catch(function (err) { done(); authNote(err.message || "Couldn't create the account."); });
    }
  });

  function wireAccount(el) {
    var uBtn = el.querySelector("#account-username");
    if (uBtn) uBtn.addEventListener("click", openUsername);
    var nBtn = el.querySelector("#account-name");
    if (nBtn) nBtn.addEventListener("click", openRename);

    var nowBtn = el.querySelector("#sync-now-btn");
    if (nowBtn) nowBtn.addEventListener("click", function () { syncNow(); });

    var outBtn = el.querySelector("#sign-out-btn");
    if (outBtn) outBtn.addEventListener("click", function () {
      openConfirm({
        title: "Sign out?",
        body: "Your synced workouts stay in your account. This phone's copy is cleared \u2014 sign back in to get it back.",
        confirmLabel: "Sign out",
        onConfirm: function () {
          syncNow().then(function () {
            var st = syncStatus().status;
            if (st === "error" || st === "offline") {
              // a stuck sync shouldn't trap you in an account
              openConfirm({
                title: "Sign out anyway?",
                body: "Some changes on this phone haven't synced and will be lost.",
                confirmLabel: "Sign out anyway",
                onConfirm: function () { signOut(STORAGE_KEY); }
              });
              return;
            }
            signOut(STORAGE_KEY);
          });
        }
      });
    });
  }

  /* ----------------------------- workout photo ----------------------------- */

  /* One photo per workout. Picked here, shrunk, and held on the workout as
     photoData until the sync uploads it. Needs an account: a phone's local
     storage would fill up after a handful of photos. */
  var photoTarget = null;

  function wirePhotoField(elId, get, set) {
    var el = document.getElementById(elId);
    if (!el) return;
    var field = el.closest(".field");
    if (!cloudEnabled()) { if (field) field.style.display = "none"; return; }

    if (!currentUser()) {
      el.innerHTML = '<button class="photo-add" type="button">Sign in to add a photo</button>';
      el.querySelector("button").onclick = function () {
        if (editingId) closeEditWorkout();
        openSettings();
      };
      return;
    }

    var src = get();
    el.innerHTML = src
      ? '<div class="photo-thumb"><img src="' + esc(src) + '" alt="Workout photo">' +
          '<button class="photo-x" type="button" aria-label="Remove photo">&times;</button></div>' +
          '<button class="photo-add is-small" type="button">Replace</button>'
      : '<button class="photo-add" type="button">+ Add photo</button>';

    el.querySelector(".photo-add").onclick = function () {
      photoTarget = { elId: elId, get: get, set: set };
      document.getElementById("photo-input").click();
    };
    var x = el.querySelector(".photo-x");
    if (x) x.onclick = function () { set(null); wirePhotoField(elId, get, set); };
  }

  document.getElementById("photo-input").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !photoTarget) return;
    var t = photoTarget;
    shrinkPhoto(file)
      .then(function (data) { t.set(data); wirePhotoField(t.elId, t.get, t.set); })
      .catch(function (err) { showToast(err.message); });
  });

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
          closeListSheet();
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
  var selectedDayKey = null; // the day shown under the calendar; null = today

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
      if (key === (selectedDayKey || todayKey)) cls.push("selected");
      // Any day up to today can be picked; the panel below shows it.
      var tappable = isMe && !isFuture;
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
                dayWorkouts.slice(0, 3).map(function (w) {
                  return isCardioWorkout(w) ? CARDIO_MARK_SVG : FLAME_SVG.replace("streak-flame", "cal-flame");
                }).join("") +
              '</span>'
            : "") +
        "</" + tag + ">";
    }

    document.getElementById("cal-grid").innerHTML = html;

    document.getElementById("cal-hint").textContent = isMe
      ? "Tap a day to see who trained."
      : "";

    // Don't browse past the current month -- there's nothing to see there.
    document.getElementById("cal-next").disabled =
      year === today.getFullYear() && month === today.getMonth();

    document.querySelectorAll("[data-cal-day]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        onCalendarDayTap(cell.getAttribute("data-cal-day"));
      });
    });
  }

  function dateFromDayKey(key) {
    var p = key.split("-");
    return new Date(Number(p[0]), Number(p[1]), Number(p[2]));
  }

  /* Tapping a day selects it; the panel under the calendar follows. */
  function onCalendarDayTap(key) {
    selectedDayKey = key;
    renderHome();
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
    document.getElementById("confirm-no").textContent = opts.cancelLabel || "Cancel";
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
    if (isCardioWorkout(workout)) tiles = cardioTiles(workout);
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

  /* The feed: everyone you follow, newest first, under day headings. Home's
     calendar answers "what happened on this day"; this answers "what's new".
     It loads a page at a time so a long history never renders all at once. */
  var FEED_PAGE = 20;
  var feedShown = FEED_PAGE;

  function dayLabelFor(d) {
    var key = localDayKey(d.toISOString());
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === localDayKey(new Date().toISOString())) return "Today";
    if (key === localDayKey(yesterday.toISOString())) return "Yesterday";
    return calendarDate(d.toISOString());
  }

  function renderFriends() {
    var friends = friendsOf(state.me.id);
    var el = document.getElementById("friends-feed");

    var manageBtn = document.getElementById("friends-manage");
    manageBtn.hidden = signedOut();
    var waiting = ((state.friendRequests || {}).incoming || []).length;
    manageBtn.textContent = waiting ? "Manage (" + waiting + ")" : "Manage";
    if (!signedOut()) refreshSocial(false);   // throttled; redraws when it lands
    if (signedOut()) {
      document.getElementById("friends-sub").textContent = "";
      el.innerHTML = '<div class="signin-card">' +
        '<div class="signin-card-icon">' + FRIENDS_SVG + '</div>' +
        '<div class="signin-card-title">No friends yet</div>' +
        '<p class="signin-card-text">Sign in to add friends and see their workouts.</p>' +
        '<button class="btn btn-primary btn-block" id="friends-sign-in" data-open-auth="signin">Sign in to see your friends</button>' +
      '</div>';
      return;
    }

    document.getElementById("friends-sub").textContent = friends.length
      ? friends.length + (friends.length === 1 ? " friend" : " friends")
      : "";

    if (!friends.length) {
      el.innerHTML = '<div class="empty-state">No friends yet. Tap Manage to find people by username. ' +
        'Their workouts show up here.</div>' +
        (waiting ? '<button class="btn btn-primary btn-block" id="feed-requests">' + waiting +
          (waiting === 1 ? " friend request" : " friend requests") + '</button>' : '');
      var reqBtn = el.querySelector("#feed-requests");
      if (reqBtn) reqBtn.addEventListener("click", openFriendsManage);
      return;
    }

    var rows = [];
    friends.forEach(function (u) {
      workoutsOf(u.id).forEach(function (wk) { rows.push({ user: u, wk: wk }); });
    });
    rows.sort(function (a, b) { return new Date(b.wk.performedAt) - new Date(a.wk.performedAt); });

    if (!rows.length) {
      el.innerHTML = '<div class="empty-state">None of your friends have logged anything yet.</div>';
      return;
    }

    // how many sessions each person logged per day, to tag a second one as #2
    var perDay = {};
    rows.forEach(function (r) {
      var k = r.user.id + "|" + localDayKey(r.wk.performedAt);
      (perDay[k] = perDay[k] || []).push(r.wk.id);
    });

    var html = "";
    var lastKey = null;
    rows.slice(0, feedShown).forEach(function (row) {
      var dayKey = localDayKey(row.wk.performedAt);
      if (dayKey !== lastKey) {
        html += '<div class="feed-day">' + esc(dayLabelFor(new Date(row.wk.performedAt))) + '</div>';
        lastKey = dayKey;
      }
      var gymObj = row.wk.gymId ? findGym(row.wk.gymId) : null;
      var exCount = row.wk.exercises.length;
      var same = perDay[row.user.id + "|" + dayKey];
      var nth = same.length > 1 ? same.length - same.indexOf(row.wk.id) : 0;
      html += '<div class="friend-card">' +
        '<button class="friend-open" data-friend-wk="' + row.wk.id + '">' +
          '<span class="profile-tap" data-profile="' + esc(row.user.id) + '">' + avatarHtml(row.user) + '</span>' +
          '<span class="person-body">' +
            '<span class="person-name">' + esc(row.user.name) +
              (nth ? '<span class="nth-tag">#' + nth + '</span>' : '') + '</span>' +
            '<span class="friend-what">' + workoutTitleHtml(row.wk) + '</span>' +
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
        (photoSrc(row.wk)
          ? '<button class="card-photo" data-friend-wk="' + row.wk.id + '">' +
              '<img src="' + esc(photoSrc(row.wk)) + '" alt="" loading="lazy"></button>'
          : '') +
        reactionBarHtml(row.wk) +
      '</div>';
    });
    if (rows.length > feedShown) {
      html += '<button class="btn btn-ghost btn-block" id="feed-more">Show more</button>';
    }
    el.innerHTML = html;

    el.querySelectorAll("[data-friend-wk]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openWorkoutDetail(btn.getAttribute("data-friend-wk"));
      });
    });
    var more = el.querySelector("#feed-more");
    if (more) more.addEventListener("click", function () {
      feedShown += FEED_PAGE;
      renderFriends();
    });
    wireReactions(el, renderFriends);
  }

  /* Friends are accounts: find someone by username, send a request, and
     they're on your feed once they accept. Removing someone ends the
     friendship only -- their workouts stay in their account. */
  var manageSearch = "";
  var manageResults = [];

  function relationTo(id) {
    var req = state.friendRequests || { incoming: [], outgoing: [] };
    if (friendsOf(state.me.id).some(function (u) { return u.id === id; })) return "friend";
    if (req.incoming.indexOf(id) !== -1) return "incoming";
    if (req.outgoing.indexOf(id) !== -1) return "outgoing";
    return "none";
  }

  /* ---------- someone's profile ---------- */

  // people seen in search results, who aren't in state.users until you're friends
  var knownPeople = {};

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-profile]");
    if (!t) return;
    // a face or name inside a bigger button opens the person, not the workout
    e.preventDefault();
    e.stopPropagation();
    openProfileById(t.getAttribute("data-profile"));
  }, true);

  function openProfileById(id) {
    if (id === state.me.id) { closeListSheet(); activateTab("profile"); return; }
    var u = findUser(id) || knownPeople[id];
    if (u) openUserProfile(u);
  }

  function profileLink(u) {
    return location.origin + location.pathname + "?add=" + encodeURIComponent(u.handle || "");
  }

  /* The share sheet on a phone; a copied link anywhere else. */
  function shareProfile(u) {
    if (!u.handle) { showToast("Set a username first, in Profile."); return; }
    var isMe = u.id === state.me.id;
    var url = profileLink(u);
    var text = isMe ? "Add me on GymSocial: @" + u.handle : "Add @" + u.handle + " on GymSocial";
    if (navigator.share) {
      navigator.share({ title: "GymSocial", text: text, url: url }).catch(function () { /* closed it */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + " " + url).then(function () { showToast("Link copied."); },
        function () { showToast(url); });
    } else showToast(url);
  }

  function openUserProfile(u) {
    var rel = relationTo(u.id);
    var theirs = workoutsOf(u.id).slice().sort(function (a, b) {
      return new Date(b.performedAt) - new Date(a.performedAt);
    });
    var weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    var thisWeek = theirs.filter(function (w) { return new Date(w.performedAt) > weekAgo; }).length;

    var action = {
      friend:   '<span class="up-tag">&#10003; Friends</span>',
      incoming: '<button class="btn btn-primary" data-up="accept">Accept</button>' +
                '<button class="btn btn-ghost" data-up="decline">Decline</button>',
      outgoing: '<button class="btn btn-ghost" data-up="cancel">Requested</button>',
      none:     '<button class="btn btn-primary" data-up="add">Add friend</button>'
    }[rel];

    var html = '<div class="up-head">' + avatarHtml(u, "is-big") +
        '<div class="profile-name">' + esc(u.name) + '</div>' +
        (u.handle ? '<div class="profile-handle">@' + esc(u.handle) + '</div>' : '') +
        '<div class="up-actions">' + action +
          '<button class="btn btn-ghost" data-up="share">Share</button></div>' +
      '</div>';

    if (rel === "friend") {
      html += '<div class="stat-grid up-stats">' +
        '<div class="stat-tile"><span class="num">' + thisWeek + '</span><span class="label">This week</span></div>' +
        '<div class="stat-tile"><span class="num">' + (theirs[0] ? esc(shortDate(theirs[0].performedAt)) : "--") +
          '</span><span class="label">Last workout</span></div></div>';
      html += '<div class="manage-head">Recent workouts</div>';
      html += theirs.length ? theirs.slice(0, 12).map(function (w) {
        var gymObj = w.gymId ? findGym(w.gymId) : null;
        return '<button class="up-wk" data-up-wk="' + esc(w.id) + '">' +
          '<span class="person-body"><span class="person-name">' + esc(w.title || "Workout") + '</span>' +
          '<span class="person-sub">' + [esc(calendarDate(w.performedAt)), gymObj ? esc(gymLabel(gymObj)) : null]
            .concat(sessionFacts(w).map(esc)).filter(Boolean).join(" &middot; ") + '</span></span>' +
          '<span class="chevron">&rsaquo;</span></button>';
      }).join("") : '<div class="empty-state">Nothing logged yet.</div>';
    } else {
      html += '<p class="up-locked">' + (rel === "outgoing"
        ? "Once @" + esc(u.handle) + " accepts, their workouts show up here and in your feed."
        : "Add @" + esc(u.handle) + " as a friend to see their workouts.") + '</p>';
    }

    var el = openListSheet("Profile", html);
    var after = function (msg) {
      return function () {
        if (msg) showToast(msg);
        renderFriends(); renderHome();
        openUserProfile(findUser(u.id) || u);
      };
    };
    var fail = function (err) { showToast((err && err.message) || "That didn't go through. Try again."); };
    el.querySelectorAll("[data-up]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var k = btn.getAttribute("data-up");
        if (k === "share") { shareProfile(u); return; }
        btn.disabled = true;
        if (k === "add") sendFriendRequest(u.id).then(after("Request sent to " + u.name + ".")).catch(fail);
        else if (k === "accept") acceptFriendRequest(u.id).then(after("You and " + u.name + " are friends.")).catch(fail);
        else if (k === "decline") declineFriendRequest(u.id).then(after(null)).catch(fail);
        else if (k === "cancel") cancelFriendRequest(u.id).then(after("Request canceled.")).catch(fail);
      });
    });
    el.querySelectorAll("[data-up-wk]").forEach(function (b) {
      b.addEventListener("click", function () { openWorkoutDetail(b.getAttribute("data-up-wk")); });
    });
  }

  /* ---------- a shared profile link: ?add=<username> ---------- */
  var pendingAdd = null;
  var authResolved = false;     // has Supabase said whether we're signed in yet?
  var addPromptShown = false;

  function processPendingAdd() {
    if (!pendingAdd) return;
    if (!cloudEnabled()) { pendingAdd = null; return; }
    if (!currentUser()) {
      if (authResolved && !addPromptShown) {
        addPromptShown = true;
        openAuth("signin");
        authNote("Sign in or create an account to add @" + pendingAdd + ".", true);
      }
      return;
    }
    var handle = pendingAdd;
    pendingAdd = null;
    searchPeople(handle).then(function (list) {
      var u = list.filter(function (x) { return x.handle === handle; })[0];
      if (!u) {
        if (state.me.handle === handle) showToast("That's your own profile link.");
        else showToast("Couldn't find @" + handle + ".");
        return;
      }
      knownPeople[u.id] = u;
      activateTab("friends");
      openUserProfile(findUser(u.id) || u);
    }).catch(function () { showToast("Couldn't open @" + handle + " right now."); });
  }

  /* ---------- reuse a workout ---------- */

  /* Starts today's workout as a copy: same exercises and equipment, every
     set filled in (lighter, like a suggestion) with that workout's numbers.
     A friend's exercises are matched to yours by name. */
  function startReuse(wk) {
    var go = function () {
      var mine = wk.userId === state.me.id;
      resetDraft();
      draft.kind = isCardioWorkout(wk) ? "cardio" : "lift";
      draft.title = wk.title || "";
      // into the box now: rendering the log saves the draft from what's on screen
      document.getElementById("log-title").value = draft.title;
      if (wk.gymId && state.gyms.some(function (g) { return g.id === wk.gymId; })) draft.gymId = wk.gymId;
      draft.exercises = wk.exercises.map(function (blk) {
        var ex = findExercise(blk.exerciseId);
        var exId = blk.exerciseId;
        var equip = blk.equipment || null;
        var own = mine && state.exercises.some(function (e) { return e.id === exId; }) && !retiredExercise(exId);
        if (blk.metric === "cardio") {
          // a friend's run becomes your Run
          if (!own) { if (!ex) return null; exId = ensureActivity(ex.name).id; }
          equip = null;
        } else if (!own) {
          if (!ex) return null;
          var parsed = parseExerciseName(ex.name);
          exId = findOrCreateExercise(parsed ? parsed.base : ex.name).id;
          if (!equip && parsed) equip = parsed.equipment;
        }
        if (equip) ensureEquipment(equip);
        var out = {
          exerciseId: exId, metric: metricOf(blk), equipment: equip,
          sets: blk.sets.map(function (st) {
            return { reps: st.reps == null ? null : st.reps, seconds: st.seconds == null ? null : st.seconds,
              weight: st.weight == null ? null : st.weight, distance: st.distance == null ? null : st.distance,
              unit: st.unit || "lb", distUnit: st.distUnit || "mi",
              intensity: st.intensity == null ? null : st.intensity,
              heartRate: st.heartRate == null ? null : st.heartRate,
              steps: st.steps == null ? null : st.steps, prefill: true };
          })
        };
        if (blk.superset) out.superset = blk.superset;
        return out;
      }).filter(Boolean);
      persist();
      closeListSheet();
      activateTab("log");
      renderLog();
      showToast("Reusing \u201c" + (wk.title || "Workout") + "\u201d \u2014 type over any number to change it.");
    };
    saveDraft();
    if (draft.exercises && draft.exercises.length) { closeListSheet(); openDraftChoice("today", go); return; }
    go();
  }

  function openReusePicker() {
    var list = myWorkouts().slice().sort(function (a, b) {
      return new Date(b.performedAt) - new Date(a.performedAt);
    }).slice(0, 25);
    var el = openListSheet("Reuse a workout", list.map(function (w) {
      var n = w.exercises.length;
      return '<button class="up-wk" data-reuse="' + esc(w.id) + '">' +
        '<span class="person-body"><span class="person-name">' + esc(w.title || "Workout") + '</span>' +
        '<span class="person-sub">' + esc(calendarDate(w.performedAt)) + ' &middot; ' + n +
          (n === 1 ? " exercise" : " exercises") + '</span></span>' +
        '<span class="chevron">&rsaquo;</span></button>';
    }).join("") || '<div class="empty-state">Nothing logged yet.</div>');
    el.querySelectorAll("[data-reuse]").forEach(function (b) {
      b.addEventListener("click", function () {
        var wk = state.workouts.filter(function (w) { return w.id === b.getAttribute("data-reuse"); })[0];
        if (!wk) return;
        openConfirm({
          title: "Reuse \u201c" + (wk.title || "Workout") + "\u201d?",
          body: "Starts today's workout with the same exercises, filled in with the numbers from " +
            calendarDate(wk.performedAt) + ".",
          confirmLabel: "Reuse", danger: false,
          onConfirm: function () { startReuse(wk); }
        });
      });
    });
  }

  function personRowHtml(u, actions) {
    knownPeople[u.id] = u;
    return '<div class="manage-row">' +
      '<span class="profile-tap person-tap" data-profile="' + esc(u.id) + '">' +
        avatarHtml(u) +
        '<span class="person-body">' +
          '<span class="person-name">' + esc(u.name) + '</span>' +
          '<span class="person-sub">@' + esc(u.handle || "") + '</span>' +
        '</span>' +
      '</span>' +
      '<span class="manage-acts">' + actions + '</span>' +
    '</div>';
  }

  function actBtn(kind, id, label, cls) {
    return '<button class="' + (cls || "manage-act") + '" data-act="' + kind + '" data-id="' + esc(id) + '">' +
      label + '</button>';
  }

  function actionsFor(u) {
    switch (relationTo(u.id)) {
      case "friend":   return '<span class="manage-tag">Friends</span>';
      case "incoming": return actBtn("accept", u.id, "Accept", "manage-act is-primary") +
                              actBtn("decline", u.id, "Decline");
      case "outgoing": return actBtn("cancel", u.id, "Requested");
      default:         return actBtn("add", u.id, "Add", "manage-act is-primary");
    }
  }

  function manageListsHtml() {
    var req = state.friendRequests || { incoming: [], outgoing: [] };
    var friends = friendsOf(state.me.id);
    var people = function (ids) { return ids.map(findUser).filter(Boolean); };
    var html = "";

    var incoming = people(req.incoming);
    if (incoming.length) {
      html += '<div class="manage-head">Requests</div>' + incoming.map(function (u) {
        return personRowHtml(u, actBtn("accept", u.id, "Accept", "manage-act is-primary") +
          actBtn("decline", u.id, "Decline"));
      }).join("");
    }

    var outgoing = people(req.outgoing);
    if (outgoing.length) {
      html += '<div class="manage-head">Sent</div>' + outgoing.map(function (u) {
        return personRowHtml(u, actBtn("cancel", u.id, "Cancel"));
      }).join("");
    }

    html += '<div class="manage-head">Friends' + (friends.length ? ' (' + friends.length + ')' : '') + '</div>';
    html += friends.length
      ? friends.map(function (u) {
          return personRowHtml(u, actBtn("remove", u.id, "Remove", "manage-drop"));
        }).join("")
      : '<div class="empty-state">Nobody yet. Search above to add someone.</div>';
    return html;
  }

  function drawManage(el) {
    var res = el.querySelector("#manage-results");
    var q = manageSearch.trim();
    res.innerHTML = q.length < 2 ? "" : (manageResults.length
      ? manageResults.map(function (u) { return personRowHtml(u, actionsFor(u)); }).join("")
      : '<p class="setting-help">No one with that username.</p>');
    el.querySelector("#manage-lists").innerHTML = manageListsHtml();
    wireManageActs(el);
  }

  function wireManageActs(el) {
    el.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.onclick = function () {
        var kind = btn.getAttribute("data-act");
        var id = btn.getAttribute("data-id");
        var u = findUser(id) || manageResults.filter(function (x) { return x.id === id; })[0] || { name: "them" };
        var run = function (fn, done) {
          btn.disabled = true;
          fn(id)
            .then(function () {
              if (done) showToast(done);
              drawManage(el);
              renderFriends();
              renderHome();
            })
            .catch(function (err) {
              btn.disabled = false;
              showToast((err && err.message) || "That didn't go through. Try again.");
            });
        };
        if (kind === "add") run(sendFriendRequest, "Request sent to " + u.name + ".");
        else if (kind === "accept") run(acceptFriendRequest, "You and " + u.name + " are friends.");
        else if (kind === "decline") run(declineFriendRequest, null);
        else if (kind === "cancel") run(cancelFriendRequest, "Request canceled.");
        else if (kind === "remove") {
          openConfirm({
            title: "Remove " + u.name + "?",
            body: "They come off your feed and you come off theirs. Their workouts stay in their account.",
            confirmLabel: "Remove",
            onConfirm: function () {
              removeFriend(id)
                .then(function () {
                  openFriendsManage();
                  renderFriends();
                  renderHome();
                  showToast("Removed " + u.name + ".");
                })
                .catch(function (err) { showToast((err && err.message) || "Couldn't remove them."); });
            }
          });
        }
      };
    });
  }

  function openFriendsManage() {
    if (signedOut()) { openAuth("signin"); return; }
    manageSearch = "";
    manageResults = [];
    var el = openListSheet("Friends",
      '<div class="find-box">' +
        '<svg class="find-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>' +
        '<input type="search" id="friend-search" placeholder="Search by username" ' +
          'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">' +
        '<button type="button" class="find-clear" id="friend-clear" aria-label="Clear" hidden>' +
          '<svg viewBox="0 0 24 24" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg></button>' +
      '</div>' +
      '<p class="find-hint">You\'re <strong>@' + esc(state.me.handle || "") +
        '</strong> \u00b7 friends find you by that</p>' +
      '<div id="manage-results"></div>' +
      '<div id="manage-lists"></div>');
    drawManage(el);

    var input = el.querySelector("#friend-search");
    var clear = el.querySelector("#friend-clear");
    var timer = null;
    var asked = 0;
    clear.addEventListener("click", function () {
      input.value = "";
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
    input.addEventListener("input", function () {
      clear.hidden = !input.value;
      manageSearch = input.value;
      clearTimeout(timer);
      if (manageSearch.trim().length < 2) { manageResults = []; drawManage(el); return; }
      timer = setTimeout(function () {
        var mine = ++asked;
        searchPeople(manageSearch)
          .then(function (list) {
            if (mine !== asked) return;      // a newer search already answered
            manageResults = list;
            drawManage(el);
          })
          .catch(function () { showToast("Search isn't working right now."); });
      }, 300);
    });
    refreshSocial(true).then(function () {
      if (document.getElementById("list-modal-overlay").classList.contains("open") &&
          el.querySelector("#manage-lists")) drawManage(el);
    });
  }

  document.getElementById("friends-manage").addEventListener("click", openFriendsManage);

  /* ----------------------------- inbox ----------------------------- */

  /* What happened to you: friend requests waiting on an answer, then
     reactions to your workouts and friendships that came through. "Unread"
     is anything newer than the last time the Inbox was opened; that time
     lives in settings, so reading it on one phone clears it on the other. */
  var BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5a6 6 0 0 1 12 0c0 4.3 1.3 5.9 2 7H4c.7-1.1 2-2.7 2-7z"/>' +
    '<path d="M10 19.5a2.1 2.1 0 0 0 4 0"/></svg>';

  /* Never opened: only the last few days count as new, not all of history. */
  function inboxSeen() {
    return state.settings.inboxSeenAt || new Date(Date.now() - 3 * 864e5).toISOString();
  }

  function inboxActivity() {
    if (!currentUser()) return [];
    return (state.inbox || []).filter(function (it) {
      if (it.kind !== "reaction") return true;
      return state.workouts.some(function (w) { return w.id === it.workoutId; });
    });
  }

  function inboxRequests() {
    if (!currentUser()) return [];
    return ((state.friendRequests || {}).incoming || []).map(findUser).filter(Boolean);
  }

  /* Requests count until they're answered; activity until it's been seen. */
  function inboxUnread() {
    var seen = inboxSeen();
    return inboxRequests().length +
      inboxActivity().filter(function (it) { return it.at && it.at > seen; }).length;
  }

  function renderBell() {
    var badge = document.getElementById("inbox-badge");
    if (!badge) return;
    var n = inboxUnread();
    badge.hidden = !n;
    badge.textContent = n > 9 ? "9+" : String(n);
    document.getElementById("open-inbox").setAttribute("aria-label", n ? "Inbox, " + n + " new" : "Inbox");
  }

  /* "now", "5m", "2h", "3d", then a date. */
  function agoShort(iso) {
    if (!iso) return "";
    var sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return "now";
    if (sec < 3600) return Math.floor(sec / 60) + "m";
    if (sec < 86400) return Math.floor(sec / 3600) + "h";
    if (sec < 7 * 86400) return Math.floor(sec / 86400) + "d";
    return shortDate(iso);
  }

  /* `seen` is passed in rather than read, so rows stay marked new for as
     long as this sheet is open even though opening it marks them seen. */
  function inboxHtml(seen) {
    var html = '<div id="inbox-root">';
    var requests = inboxRequests();
    var at = (state.friendRequests || {}).at || {};
    if (requests.length) {
      html += '<div class="manage-head">Requests</div>' + requests.map(function (u) {
        knownPeople[u.id] = u;
        return '<div class="manage-row inbox-request">' +
          '<span class="profile-tap person-tap" data-profile="' + esc(u.id) + '">' +
            avatarHtml(u) +
            '<span class="person-body">' +
              '<span class="person-name">' + esc(u.name) + '</span>' +
              '<span class="person-sub">@' + esc(u.handle || "") +
                (at[u.id] ? ' &middot; ' + esc(agoShort(at[u.id])) : '') + '</span>' +
            '</span>' +
          '</span>' +
          '<span class="manage-acts">' + actBtn("accept", u.id, "Accept", "manage-act is-primary") +
            actBtn("decline", u.id, "Decline") + '</span>' +
        '</div>';
      }).join("");
    }

    var items = inboxActivity();
    if (items.length || requests.length) html += '<div class="manage-head">Activity</div>';
    html += items.length ? items.map(function (it) {
      var u = findPerson(it.userId) || { id: it.userId, name: "Someone" };
      if (u.handle) knownPeople[u.id] = u;
      var name = '<strong>' + esc(u.name) + '</strong>';
      var text, target;
      if (it.kind === "reaction") {
        var wk = state.workouts.filter(function (w) { return w.id === it.workoutId; })[0];
        text = name + ' <span class="inbox-emoji">' + esc(oneEmoji(it.emoji) || "❤️") + '</span> your ' +
          '<strong>' + esc(wk.title || "workout") + '</strong>';
        target = ' data-inbox-wk="' + esc(it.workoutId) + '"';
      } else {
        text = it.kind === "accepted" ? name + ' accepted your request' : 'You and ' + name + ' are friends';
        target = ' data-profile="' + esc(u.id) + '"';
      }
      return '<button class="inbox-row' + (it.at && it.at > seen ? " is-new" : "") + '"' + target + '>' +
        '<span class="profile-tap" data-profile="' + esc(u.id) + '">' + avatarHtml(u) + '</span>' +
        '<span class="inbox-text">' + text + '</span>' +
        '<span class="inbox-when">' + esc(agoShort(it.at)) + '</span>' +
      '</button>';
    }).join("") : '<div class="empty-state">' + (requests.length
      ? "Nothing else yet."
      : "Nothing yet. Friend requests and reactions to your workouts show up here.") + '</div>';
    return html + '</div>';
  }

  function inboxIsOpen() {
    return document.getElementById("list-modal-overlay").classList.contains("open") &&
      !!document.getElementById("inbox-root");
  }

  function markInboxSeen() {
    // at least as late as the newest thing shown: the server's clock stamps
    // activity, and this phone's may be a little behind it
    var latest = new Date().toISOString();
    inboxActivity().forEach(function (it) { if (it.at && it.at > latest) latest = it.at; });
    state.settings.inboxSeenAt = latest;
    persist();
    renderBell();
  }

  function drawInbox(el, seen) {
    el.innerHTML = inboxHtml(seen);
    el.querySelectorAll("[data-inbox-wk]").forEach(function (b) {
      b.addEventListener("click", function () { openWorkoutDetail(b.getAttribute("data-inbox-wk")); });
    });
    el.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.onclick = function () {
        var accept = btn.getAttribute("data-act") === "accept";
        var id = btn.getAttribute("data-id");
        var u = findPerson(id) || { name: "them" };
        el.querySelectorAll('[data-id="' + id + '"]').forEach(function (b) { b.disabled = true; });
        (accept ? acceptFriendRequest(id) : declineFriendRequest(id))
          .then(function () {
            if (accept) showToast("You and " + u.name + " are friends.");
            if (inboxIsOpen()) drawInbox(el, seen);
            renderBell();
            renderFriends();
            renderHome();
          })
          .catch(function (err) {
            el.querySelectorAll('[data-id="' + id + '"]').forEach(function (b) { b.disabled = false; });
            showToast((err && err.message) || "That didn't go through. Try again.");
          });
      };
    });
  }

  function openInbox() {
    if (signedOut()) {
      openListSheet("Inbox", '<div class="signin-card is-flat">' +
        '<div class="signin-card-icon">' + BELL_SVG + '</div>' +
        '<div class="signin-card-title">Nothing here yet</div>' +
        '<p class="signin-card-text">Sign in to get friend requests and see who reacted to your workouts.</p>' +
        '<button class="btn btn-primary btn-block" data-open-auth="signin">Sign in</button>' +
      '</div>').querySelector("[data-open-auth]").addEventListener("click", closeListSheet);
      return;
    }
    var seen = inboxSeen();
    var el = openListSheet("Inbox", "");
    drawInbox(el, seen);
    markInboxSeen();
    var fresh = refreshSocial(true);
    if (fresh) fresh.then(function () {
      if (!inboxIsOpen()) return;
      drawInbox(el, seen);
      markInboxSeen();
    }).catch(function () { /* offline: what's on this phone is still shown */ });
  }

  document.getElementById("open-inbox").addEventListener("click", openInbox);

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
    if (isCardioWorkout(wk)) tiles = cardioTiles(wk);
    tiles = tiles.slice(0, 4);

    var ssLabels = supersetLabels(wk.exercises);

    var who = mine ? null : findUser(wk.userId);
    var html =
      '<div class="detail-head">' +
        (who
          ? '<div class="detail-who" data-profile="' + esc(who.id) + '">' + avatarHtml(who) +
            '<span>' + esc(who.name) + '</span><span class="chevron">&rsaquo;</span></div>'
          : '') +
        '<div class="detail-title">' + workoutTitleHtml(wk) + '</div>' +
        '<div class="detail-when">' + calendarDate(wk.performedAt) + ' &middot; ' +
          esc(formatTime(wk.performedAt)) +
          (wk.endedAt ? ' &ndash; ' + esc(formatTime(wk.endedAt)) : '') + '</div>' +
        (gymObj
          ? '<div class="detail-gym"><span class="detail-gym-name">' + esc(gymLabel(gymObj)) + '</span>' +
            (gymAddress(gymObj) ? '<span class="detail-gym-addr">' + esc(gymAddress(gymObj)) + '</span>' : '') +
            '</div>'
          : '') +
      '</div>';

    if (photoSrc(wk)) {
      html += '<img class="detail-photo" src="' + esc(photoSrc(wk)) + '" alt="Workout photo">';
    }

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
          esc(summarizeSets(blk.sets, metricOf(blk), blk.equipment, exObj && exObj.name)) + '</div>' +
        (blk.note ? '<div class="detail-ex-note">' + esc(blk.note) + '</div>' : '') +
      '</div>';
    }).join("");

    if (mine) {
      html += reactorsHtml(wk);
      html += '<button class="btn btn-ghost btn-block" id="detail-edit" style="margin-top:18px;">Edit workout</button>';
    } else {
      html += '<div class="detail-react">' + reactionBarHtml(wk) + '</div>';
    }
    html += '<button class="btn btn-ghost btn-block" id="detail-reuse" style="margin-top:' + (mine ? 8 : 16) + 'px;">' +
      (mine ? "Reuse this workout" : "Do this workout") + '</button>';

    var el = openListSheet("Workout", html);
    el.querySelector("#detail-reuse").addEventListener("click", function () { startReuse(wk); });
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
  /* Backup and erase, in a sheet of their own: everything that can
     overwrite or wipe your log is behind one deliberate tap. */
  function openDataSheet() {
    var el = openListSheet("Data",
        '<div class="setting-block">' +
          '<label class="field-label">Backup</label>' +
          '<div class="action-row" style="margin-bottom:0;">' +
            '<button class="btn btn-ghost" data-backup="export">Export data</button>' +
            '<button class="btn btn-ghost" data-backup="import">Restore</button>' +
          '</div>' +
          '<p class="setting-help">Browser storage isn\'t permanent. Export a copy you can paste back in, or move to a new phone.</p>' +
        '</div>' +
        '<div class="setting-block">' +
          '<label class="field-label">Erase</label>' +
          '<button class="btn btn-ghost btn-block" id="reset-demo-btn" ' +
            'style="color:var(--danger);border-color:var(--danger);">Erase all my data</button>' +
          '<p class="setting-help">Deletes every workout, gym and exercise' + (currentUser() ? ', here and in your account on every device' : ' on this phone') + '. ' +
            'Export a backup first.</p>' +
        '</div>');
    wireEraseButton(el);
    el.querySelectorAll("[data-backup]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.getAttribute("data-backup") === "export") openExportSheet();
        else openImportSheet();
      });
    });
  }

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
    if (isCardioWorkout(wk) && wk.exercises.length === 1) {
      var ex0 = findExercise(wk.exercises[0].exerciseId);
      var rate = cardioRate(wk.exercises[0].sets[0], activityProfile(ex0 ? ex0.name : ""));
      if (rate) facts.push(rate);
    }
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

  var tabBeforeLog = "home";   // where Cancel on the log screen goes back to

  function activateTab(name) {
    if (name === "log" && currentTab !== "log" && currentTab !== "settings") tabBeforeLog = currentTab || "home";
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

    // a new page starts at the top; a redraw of the same page stays put
    if (switching) document.getElementById("screen-" + name).scrollTop = 0;
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
          equipment: blk.equipment || null,
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
    editDraft.photo = photoSrc(wk);
    editDraft.photoNew = null;
    editDraft.photoRemoved = false;
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
    wirePhotoField("edit-photo",
      function () { return editDraft.photoNew || (editDraft.photoRemoved ? null : editDraft.photo); },
      function (d) {
        editDraft.photoNew = d || null;
        if (!d) editDraft.photoRemoved = true;
      });
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
    openExercisePicker(function (exObj, equip) {
      editDraft.exercises.push(blockFromLastTime(exObj, editingId, equip));
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
    if (editDraft.photoNew) {
      wk.photoData = editDraft.photoNew;
    } else if (editDraft.photoRemoved) {
      delete wk.photoData;
      wk.photoPath = null;
      wk.photoUrl = null;
    }
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
      kind: "lift",          // "cardio" = one activity, posted on its own
      stash: null,           // the other mode's entries, kept while you flip
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
    ["log-title", "log-calories"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ }
  }

  /* A half-logged session used to live only in memory, so swiping the app
     away lost it. It is written out on every change now and picked back up
     on the next open. */
  /* The title and calories live in plain inputs rather than on the draft,
     so they are read in at save time -- otherwise a restore brings back the
     sets but not what you called the session. */
  /* An untouched cardio form isn't "a workout in progress" -- only what you
     typed is. Lift exercises count as soon as they're added. */
  function draftHasContent(d) {
    var typed = (d.exercises || []).some(function (b) {
      if (b.metric !== "cardio") return true;
      if (b.note) return true;
      return b.sets.some(function (st) {
        return !st.prefill && (st.seconds != null || st.distance != null || st.steps != null ||
          st.heartRate != null || st.intensity != null);
      });
    });
    return typed || d.title || d.calories || d.photoData;
  }

  function saveDraft() {
    var t = document.getElementById("log-title");
    var c = document.getElementById("log-calories");
    if (t) draft.title = t.value;
    if (c) draft.calories = c.value;
    try {
      if (!draftHasContent(draft)) localStorage.removeItem(DRAFT_KEY);
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
    if (!draftHasContent(saved)) return false;   // nothing worth restoring
    draft = {
      kind: saved.kind === "cardio" ? "cardio" : "lift",
      stash: Array.isArray(saved.stash) ? saved.stash : null,
      title: saved.title || "",
      calories: saved.calories || "",
      gymId: saved.gymId || "",
      date: saved.date || dateInputValue(new Date().toISOString()),
      startTime: saved.startTime || timeInputValue(new Date().toISOString()),
      endTime: saved.endTime || "",
      photoData: saved.photoData || null,
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
    // Swiping the app away gives no warning, but going to the background
    // does -- write immediately then rather than trusting the 250ms timer.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { clearTimeout(timer); saveDraft(); }
    });
    window.addEventListener("pagehide", function () { clearTimeout(timer); saveDraft(); });
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

  /* One activity: what it was, then its numbers. On a Cardio post the
     activity rail is the header; as a finisher inside a lift it has a name
     and a Remove like any exercise. */
  function cardioBlockHtml(blk, i, exObj, standalone, excludeWorkoutId) {
    var name = exObj ? exObj.name : "Cardio";
    var prof = activityProfile(name);
    if (!blk.sets.length) blk.sets.push(blankCardioSet(prof));
    var st = blk.sets[0];
    if (prof.dist && prof.dist.indexOf(st.distUnit) === -1) st.distUnit = prof.dist[0];
    var pf = st.prefill ? " is-prefill" : "";
    var p = splitDuration(st.seconds);
    var val = function (v) { return v == null ? "" : esc(v); };

    var last = lastSessionFor(blk.exerciseId, excludeWorkoutId);
    var lastLine = last
      ? '<div class="last-time">Last time <strong>' + esc(cardioSummary(last.block.sets[0], name)) +
          '</strong> &middot; ' + shortDate(last.workout.performedAt) + '</div>'
      : '<div class="last-time is-new">First time logging this</div>';

    var rail = '<div class="equip-scroll activity-scroll">' + activityList().map(function (a) {
        return '<button class="equip-btn activity-btn' + (a === name ? " selected" : "") +
          '" data-activity="' + i + ':' + esc(a) + '">' + activityProfile(a).icon + ' ' + esc(a) + '</button>';
      }).join("") +
      '<button class="equip-btn is-add" data-activity-add="' + i + '">+ Add</button></div>';

    var field = function (label, inner) {
      return '<label class="cf"><span class="cf-label">' + label + '</span>' + inner + '</label>';
    };
    var grid = field("Time",
        '<span class="dur-group">' +
          '<input type="number" inputmode="numeric" class="c-h' + pf + '" placeholder="h" value="' + esc(p.h) + '">' +
          '<input type="number" inputmode="numeric" class="c-m' + pf + '" placeholder="m" value="' + esc(p.m) + '">' +
          '<input type="number" inputmode="numeric" class="c-s' + pf + '" placeholder="s" value="' + esc(p.s) + '">' +
        '</span>');
    if (prof.dist) {
      grid += field("Distance",
        '<span class="cf-row"><input type="number" inputmode="decimal" class="c-dist' + pf + '" placeholder="0" value="' + val(st.distance) + '">' +
        (prof.dist.length > 1
          ? '<button type="button" class="unit-toggle" data-cardio-unit>' + esc(st.distUnit) + '</button>'
          : '<span class="cf-unit">' + esc(prof.dist[0]) + '</span>') + '</span>');
    }
    if (prof.rate) {
      grid += '<div class="cf cf-rate"><span class="cf-label">' +
        { pace: "Avg pace", speed: "Avg speed", split: "Avg split" }[prof.rate] + '</span>' +
        '<span class="cf-rate-val" data-cardio-rate>' + (esc(cardioRate(st, prof)) || "&mdash;") + '</span></div>';
    }
    if (prof.intensity) {
      grid += field(esc(prof.intensity), '<input type="number" inputmode="decimal" class="c-int' + pf + '" placeholder="0" value="' + val(st.intensity) + '">');
    }
    grid += field("Avg heart rate", '<input type="number" inputmode="numeric" class="c-hr' + pf + '" placeholder="bpm" value="' + val(st.heartRate) + '">');
    if (prof.steps) {
      grid += field("Steps", '<input type="number" inputmode="numeric" class="c-steps' + pf + '" placeholder="0" value="' + val(st.steps) + '">');
    }

    return '<div class="exercise-block is-cardio" data-cardio-block="' + i + '">' +
      (standalone ? '' :
        '<div class="exercise-block-head"><h3 class="ex-name">' + prof.icon + ' ' + esc(name) + '</h3>' +
          '<button class="btn-danger-text" data-remove-ex="' + i + '">Remove</button></div>') +
      rail + lastLine +
      '<div class="cardio-grid">' + grid + '</div>' +
      '<textarea class="note-input" rows="2" data-note="' + i + '" placeholder="Notes: how it felt, the route, the weather...">' +
        esc(blk.note || "") + '</textarea>' +
    '</div>';
  }

  function wireCardioBlocks(containerEl, draftObj, rerender, excludeWorkoutId) {
    containerEl.querySelectorAll("[data-cardio-block]").forEach(function (el) {
      var blk = draftObj.exercises[Number(el.getAttribute("data-cardio-block"))];
      var st = blk.sets[0];
      var exObj = findExercise(blk.exerciseId);
      var prof = activityProfile(exObj ? exObj.name : "");
      var q = function (c) { return el.querySelector(c); };
      var num = function (input) { return input && input.value !== "" ? Number(input.value) : null; };
      var rateEl = el.querySelector("[data-cardio-rate]");
      var read = function () {
        st.seconds = joinDuration(q(".c-h").value, q(".c-m").value, q(".c-s").value);
        if (q(".c-dist")) st.distance = num(q(".c-dist"));
        if (q(".c-int")) st.intensity = num(q(".c-int"));
        st.heartRate = num(q(".c-hr"));
        if (q(".c-steps")) st.steps = num(q(".c-steps"));
        if (rateEl) rateEl.textContent = cardioRate(st, prof) || "\u2014";
      };
      el.querySelector(".cardio-grid").addEventListener("input", function () {
        if (st.prefill) {
          delete st.prefill;
          el.querySelectorAll(".is-prefill").forEach(function (x) { x.classList.remove("is-prefill"); });
        }
        read();
      });
      // 90 in the seconds box becomes 1m 30s when you leave it
      [".c-h", ".c-m", ".c-s"].forEach(function (c) {
        q(c).addEventListener("change", function () {
          var p = splitDuration(st.seconds);
          q(".c-h").value = p.h; q(".c-m").value = p.m; q(".c-s").value = p.s;
        });
      });
      var unitBtn = el.querySelector("[data-cardio-unit]");
      if (unitBtn) unitBtn.addEventListener("click", function () {
        var units = prof.dist;
        st.distUnit = units[(units.indexOf(st.distUnit) + 1) % units.length];
        unitBtn.textContent = st.distUnit;
        if (rateEl) rateEl.textContent = cardioRate(st, prof) || "\u2014";
      });
    });

    containerEl.querySelectorAll("[data-activity]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var raw = btn.getAttribute("data-activity");
        var cut = raw.indexOf(":");
        var i = Number(raw.slice(0, cut));
        var act = ensureActivity(raw.slice(cut + 1));
        var keep = draftObj.exercises[i].note;
        draftObj.exercises[i] = cardioBlockFor(act, excludeWorkoutId);
        if (keep) draftObj.exercises[i].note = keep;
        persist();
        rerender();
      });
    });
    containerEl.querySelectorAll("[data-activity-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-activity-add"));
        openAddActivity(function (act) {
          draftObj.exercises[i] = cardioBlockFor(act, excludeWorkoutId);
          rerender();
        });
      });
    });
  }

  function openAddActivity(done) {
    var el = openListSheet("Add an activity",
      '<input type="text" id="activity-new" placeholder="e.g. Jump Rope, Ski Erg, Swim" autocomplete="off">' +
      '<p class="setting-help">Gets time, distance, level, heart rate, steps and notes.</p>' +
      '<button class="btn btn-primary btn-block" id="activity-save">Add</button>');
    var input = el.querySelector("#activity-new");
    input.focus();
    el.querySelector("#activity-save").addEventListener("click", function () {
      var name = titleCase(input.value);
      if (!name) { showToast("Give it a name."); return; }
      var act = ensureActivity(name);
      persist();
      closeListSheet();
      done(act);
    });
  }

  /* Lift only: a cardio finisher, picked from the same activities. */
  function openCardioPicker(done) {
    var el = openListSheet("Add cardio", '<div class="activity-grid">' + activityList().map(function (a) {
        return '<button class="activity-pick" data-pick-activity="' + esc(a) + '">' +
          '<span class="activity-pick-icon">' + activityProfile(a).icon + '</span>' + esc(a) + '</button>';
      }).join("") +
      '<button class="activity-pick is-add" data-pick-activity-add="1"><span class="activity-pick-icon">+</span>Add your own</button>' +
      '</div>');
    el.querySelectorAll("[data-pick-activity]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = ensureActivity(b.getAttribute("data-pick-activity"));
        persist();
        closeListSheet();
        done(act);
      });
    });
    el.querySelector("[data-pick-activity-add]").addEventListener("click", function () {
      openAddActivity(done);
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
    var railScroll = [].map.call(containerEl.querySelectorAll(".equip-scroll:not(.activity-scroll)"),
      function (r) { return r.scrollLeft; });

    var actScroll = [].map.call(containerEl.querySelectorAll(".activity-scroll"),
      function (r) { return r.scrollLeft; });

    containerEl.innerHTML = draftObj.exercises.map(function (blk, i) {
      var exObj = findExercise(blk.exerciseId);
      var metric = metricOf(blk);
      if (metric === "cardio") return cardioBlockHtml(blk, i, exObj, draftObj.kind === "cardio", excludeWorkoutId);
      var cfg = METRICS[metric];
      var unitKey = cfg.unitKey;

      var last = lastSessionFor(blk.exerciseId, excludeWorkoutId);
      var lastLine = last
        ? '<div class="last-time">Last time <strong>' +
            esc(summarizeSets(last.block.sets, metricOf(last.block), last.block.equipment, exObj && exObj.name)) +
            '</strong> &middot; ' + shortDate(last.workout.performedAt) + '</div>'
        : '<div class="last-time is-new">First time logging this</div>';

      var dur = usesDuration(metric);
      var noWt = dropsWeight(blk, metric);
      var rows = blk.sets.map(function (s, si) {
        var pf = s.prefill ? " is-prefill" : "";
        var v2 = metric === "distance"
          ? (s.distance == null ? "" : s.distance)
          : (s.weight == null ? "" : s.weight);
        var firstCell;
        if (dur) {
          var p = splitDuration(s.seconds);
          firstCell =
            '<span class="dur-group">' +
              '<input type="number" inputmode="numeric" class="dur-h' + pf + '" placeholder="h" value="' + esc(p.h) + '">' +
              '<input type="number" inputmode="numeric" class="dur-m' + pf + '" placeholder="m" value="' + esc(p.m) + '">' +
              '<input type="number" inputmode="numeric" class="dur-s' + pf + '" placeholder="s" value="' + esc(p.s) + '">' +
            '</span>';
        } else {
          firstCell = '<input type="number" inputmode="numeric" placeholder="Reps" class="set-v1' + pf + '" value="' +
            esc(s.reps == null ? "" : s.reps) + '">';
        }
        var col2 = metric === "distance" ? cfg.col2 : weightLabel(blk);
        var weightCells = noWt ? "" :
          '<input type="number" inputmode="decimal" placeholder="' + esc(col2) + '" class="set-v2' + pf + '"' +
            (metric === "distance" ? '' : ' data-bump-ok="1"') + ' value="' + esc(v2) + '">' +
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

    containerEl.querySelectorAll(".activity-scroll").forEach(function (rail, i) {
      if (actScroll[i] != null) { rail.scrollLeft = actScroll[i]; return; }
      var sel = rail.querySelector(".equip-btn.selected");
      if (sel) rail.scrollLeft = sel.offsetLeft - (rail.clientWidth - sel.offsetWidth) / 2;
    });
    wireCardioBlocks(containerEl, draftObj, rerender, excludeWorkoutId);

    containerEl.querySelectorAll(".equip-scroll:not(.activity-scroll)").forEach(function (rail, i) {
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
        var copy = {
          reps: last.reps, seconds: last.seconds, weight: last.weight,
          distance: last.distance, unit: last.unit || "lb", distUnit: last.distUnit || "mi"
        };
        if (last.prefill) copy.prefill = true;   // still a suggestion until typed over
        blk.sets.push(copy);
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
        // an untouched suggestion follows the equipment: dumbbell curls
        // suggest last time's dumbbell numbers, not the cable ones
        if (blk.sets.every(function (st) { return st.prefill || isBlankSet(st); })) {
          var n = blk.sets.length;
          var fresh = prefillSet(blk.exerciseId, excludeWorkoutId, blk.equipment);
          blk.sets = [fresh];
          for (var k = 1; k < n; k++) blk.sets.push(JSON.parse(JSON.stringify(fresh)));
        }
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
      // the first keystroke makes a suggested set yours
      row.addEventListener("input", function () {
        if (!setObj.prefill) return;
        delete setObj.prefill;
        row.querySelectorAll(".is-prefill").forEach(function (x) { x.classList.remove("is-prefill"); });
      }, true);
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

  /* One set to start, filled in from the first set last time you did this
     exact exercise on this exact equipment. It shows lighter until you type,
     and "+ Add set" copies whatever is above it. */
  function isBlankSet(st) {
    return st.reps == null && st.seconds == null && st.weight == null && st.distance == null;
  }

  function blankSet(unit, distUnit) {
    return { reps: null, seconds: null, weight: null, distance: null, unit: unit || "lb", distUnit: distUnit || "mi" };
  }

  function prefillSet(exerciseId, excludeWorkoutId, equipment) {
    var src = lastSessionFor(exerciseId, excludeWorkoutId, equipment || null);
    var first = src && src.block.sets[0];
    if (!first) return blankSet();
    return {
      reps: first.reps, seconds: first.seconds, weight: first.weight, distance: first.distance,
      unit: first.unit || "lb", distUnit: first.distUnit || "mi", prefill: true
    };
  }

  function blockFromLastTime(exObj, excludeWorkoutId, equipment) {
    var last = lastSessionFor(exObj.id, excludeWorkoutId);
    var metric = last ? metricOf(last.block) : (exObj.metric || "reps");
    var equip = equipment || (last && last.block.equipment) || exObj.equipment ||
      DEFAULT_EQUIPMENT[exObj.name] || null;
    if (!usesEquipment(metric)) equip = null;
    return {
      exerciseId: exObj.id,
      metric: metric,
      equipment: equip,
      sets: [prefillSet(exObj.id, excludeWorkoutId, equip)]
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
          if (metric === "cardio") return s.seconds != null || s.distance != null || s.steps != null || s.heartRate != null;
          if (metric === "distance") return s.distance != null || s.seconds != null;
          if (metric === "time") return s.seconds != null || s.weight != null;
          return s.reps != null || s.weight != null;
        }).map(function (s) {
          var c = {};
          for (var k in s) if (k !== "prefill") c[k] = s[k];
          return c;
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

  document.getElementById("reuse-btn").addEventListener("click", openReusePicker);

  /* Lift or Cardio. Flipping keeps what you'd entered on the other side, so
     a stray tap never loses a half-typed lift. */
  function setLogKind(kind) {
    if (draft.kind === kind) return;
    var other = draft.stash;
    draft.stash = draft.exercises;
    draft.kind = kind;
    if (kind === "cardio") {
      draft.exercises = other && other.length ? other : [cardioBlockFor(ensureActivity(lastActivityName()), null)];
      persist();
    } else {
      draft.exercises = other || [];
    }
    renderLog();
  }

  // start where you usually start: the activity you logged most recently
  function lastActivityName() {
    var last = myWorkouts().filter(isCardioWorkout).sort(function (a, b) {
      return new Date(b.performedAt) - new Date(a.performedAt);
    })[0];
    var ex = last && findExercise(last.exercises[0].exerciseId);
    return ex ? ex.name : "Run";
  }

  document.querySelectorAll("#log-kind [data-kind]").forEach(function (b) {
    b.addEventListener("click", function () { setLogKind(b.getAttribute("data-kind")); });
  });

  document.getElementById("add-cardio-btn").addEventListener("click", function () {
    openCardioPicker(function (act) {
      draft.exercises.push(cardioBlockFor(act, null));
      renderLog();
    });
  });

  function renderLog() {
    var cardio = draft.kind === "cardio";
    document.querySelectorAll("#log-kind [data-kind]").forEach(function (b) {
      b.classList.toggle("selected", b.getAttribute("data-kind") === (cardio ? "cardio" : "lift"));
    });
    document.getElementById("add-exercise-btn").hidden = cardio;
    document.getElementById("add-cardio-btn").hidden = cardio;
    document.getElementById("log-title").placeholder = cardio ? "e.g. Morning Run" : "e.g. Push Day";
    document.getElementById("reuse-btn").hidden =
      cardio || !myWorkouts().length || !!(draft.exercises && draft.exercises.length);
    document.getElementById("log-gym").innerHTML = gymOptionsHtml(draft.gymId);
    document.getElementById("log-date").value = draft.date;
    document.getElementById("log-start").value = draft.startTime;
    document.getElementById("log-end").value = draft.endTime || "";
    updateDurationReadout("log", draft);
    renderExerciseBlocks(document.getElementById("exercise-blocks"), draft, renderLog, null);
    wirePhotoField("log-photo",
      function () { return draft.photoData || null; },
      function (d) { draft.photoData = d; saveDraft(); });
    wireLogEvents();
    saveDraft();
  }

  /* Cancel leaves the log screen. With nothing typed it just goes back;
     with a workout in progress it asks first, so a stray tap loses nothing. */
  document.getElementById("log-cancel").addEventListener("click", function () {
    saveDraft();
    var back = function () { activateTab(tabBeforeLog || "home"); };
    if (!draftHasContent(draft)) { resetDraft(); back(); return; }
    openConfirm({
      title: "Discard your unsaved workout?",
      body: "\u201c" + (draft.title || "Untitled workout") + "\u201d will be deleted. This can\u2019t be undone.",
      confirmLabel: "Discard",
      onConfirm: function () { resetDraft(); back(); showToast("Workout discarded."); }
    });
  });

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
      openExercisePicker(function (exObj, equip) {
        draft.exercises.push(blockFromLastTime(exObj, null, equip));
        renderLog();
      });
    };

    document.getElementById("save-workout-btn").onclick = function () {
      if (!draft.exercises.length) { showToast("Add at least one exercise first."); return; }
      var cleanExercises = cleanDraftExercises(draft);
      if (!cleanExercises.length) {
        showToast(draft.kind === "cardio" ? "Add a time or distance first." : "Fill in at least one set.");
        return;
      }

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
        title: titleInput.value.trim() ||
          (draft.kind === "cardio" ? (findExercise(cleanExercises[0].exerciseId) || {}).name || null : null),
        performedAt: isoFromDateTime(draft.date, draft.startTime),
        endedAt: defaultEndIso(draft),
        calories: cals != null && !isNaN(cals) ? cals : null,
        exercises: cleanExercises
      };
      if (draft.photoData) workout.photoData = draft.photoData;
      state.workouts.push(workout);
      persist();
      titleInput.value = "";
      calInput.value = "";
      resetDraft();
      activateTab("home");
      buzz(prs.length ? [18, 60, 18, 60, 40] : 18);
      openSessionSummary(workout, prs);
      maybeAskNotifications();
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

  function pickExercise(exObj, equip) {
    var cb = exercisePickerCallback;
    closeExercisePicker();
    if (cb) cb(exObj, equip || null);
  }

  /* ---- "dumbbell bicep curls" -> Bicep Curl, with Dumbbell selected ----
     The equipment is a choice on the exercise, not part of its name, so one
     Bicep Curl collects every curl and its chart can split by equipment. */
  var EQUIP_WORDS = [
    [/\bsmith(\s+machine)?\b/i, "Smith Machine"],
    [/\b(dumbbells?|db)\b/i, "Dumbbell"],
    [/\b(barbells?|bb)\b/i, "Barbell"],
    [/\bcables?\b/i, "Cable"],
    [/\bmachines?\b/i, "Machine"],
    [/\b(bodyweight|body\s+weight|bw)\b/i, "Bodyweight"]
  ];
  // what a bare word is short for once the equipment is taken off
  var EXERCISE_ALIASES = { "bench": "Bench Press", "curl": "Bicep Curl", "bicep curl": "Bicep Curl",
    "biceps curl": "Bicep Curl", "squat": "Back Squat", "row": "Bent-Over Row", "pulldown": "Lat Pulldown",
    "incline bench": "Incline Press", "incline bench press": "Incline Press" };

  function singularWord(w) {
    var l = w.toLowerCase();
    if (/(ss|us|is)$/.test(l)) return w;                    // press, biceps -> leave
    if (/(sh|ch|ss)es$/.test(l)) return w.slice(0, -2);     // pushes -> push
    if (/ies$/.test(l) && l.length > 4) return w.slice(0, -3) + "y";   // flies -> fly
    if (/[^s]s$/.test(l) && l.length > 3) return w.slice(0, -1);       // curls -> curl
    return w;
  }

  // compare names loosely: case, plurals and "biceps"/"bicep" don't matter
  function exerciseKey(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter(Boolean).map(function (w) { return singularWord(w.replace(/s$/, "")); }).join(" ");
  }

  function parseExerciseName(raw) {
    var text = String(raw || "").trim();
    var equipment = null;
    for (var i = 0; i < EQUIP_WORDS.length && !equipment; i++) {
      if (EQUIP_WORDS[i][0].test(text)) {
        equipment = EQUIP_WORDS[i][1];
        text = text.replace(EQUIP_WORDS[i][0], " ");
      }
    }
    if (!equipment) return null;
    text = text.replace(/\b(with|on|using|the|a)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (!text) return null;
    var words = text.split(" ");
    words[words.length - 1] = singularWord(words[words.length - 1]);
    var base = titleCase(words.join(" "));
    var alias = EXERCISE_ALIASES[base.toLowerCase()];
    return { base: alias || base, equipment: equipment };
  }

  function retiredExercise(id) {
    return (state.settings.retiredExercises || []).indexOf(id) !== -1;
  }

  function exerciseByKey(name) {
    var key = exerciseKey(name);
    return state.exercises.filter(function (e) {
      return !retiredExercise(e.id) && exerciseKey(e.name) === key;
    })[0] || null;
  }

  function ensureEquipment(name) {
    var st = state.settings;
    if (equipmentList(true).indexOf(name) === -1) st.customEquipment.push(name);
    st.hiddenEquipment = (st.hiddenEquipment || []).filter(function (x) { return x !== name; });
  }

  /* Cardio activities are exercises too (so history, charts and sync all
     just work), marked metric "cardio". Made the first time they're used. */
  function ensureActivity(name) {
    var key = exerciseKey(name);
    var found = state.exercises.filter(function (e) {
      return !retiredExercise(e.id) && e.metric === "cardio" && exerciseKey(e.name) === key;
    })[0];
    if (found) return found;
    var ex = { id: uid("ex"), name: name, category: "cardio", metric: "cardio" };
    state.exercises.push(ex);
    return ex;
  }

  // built-ins first, then any you added yourself
  function activityList() {
    var custom = state.exercises.filter(function (e) {
      return e.metric === "cardio" && !retiredExercise(e.id) && CARDIO_BUILTIN.indexOf(e.name) === -1;
    }).map(function (e) { return e.name; });
    return CARDIO_BUILTIN.concat(custom);
  }

  function blankCardioSet(prof) {
    return { reps: null, seconds: null, weight: null, distance: null, unit: "lb",
      distUnit: (prof.dist && prof.dist[0]) || "mi", intensity: null, heartRate: null, steps: null };
  }

  // last time's numbers for this activity, lighter until you type
  function cardioBlockFor(exObj, excludeWorkoutId) {
    var prof = activityProfile(exObj.name);
    var last = lastSessionFor(exObj.id, excludeWorkoutId);
    var src = last && last.block.sets[0];
    var st = blankCardioSet(prof);
    if (src) {
      ["seconds", "distance", "distUnit", "intensity", "heartRate", "steps"].forEach(function (k) {
        if (src[k] != null) st[k] = src[k];
      });
      st.prefill = true;
    }
    return { exerciseId: exObj.id, metric: "cardio", sets: [st] };
  }

  /* "Treadmill Run" and "Stationary Bike" were Distance exercises before
     cardio existed. They become Run and Bike; their sessions come along,
     merged into one entry each (total time, total distance). */
  var OLD_CARDIO_NAMES = { "treadmill run": "Run", "stationary bike": "Bike" };

  function migrateCardio() {
    var changed = false;
    state.exercises.slice().forEach(function (ex) {
      var to = OLD_CARDIO_NAMES[ex.name.toLowerCase()];
      if (!to || retiredExercise(ex.id)) return;
      var target = state.exercises.filter(function (e) {
        return e !== ex && !retiredExercise(e.id) && e.metric === "cardio" && e.name === to;
      })[0];
      if (target) {
        state.settings.retiredExercises = state.settings.retiredExercises || [];
        state.settings.retiredExercises.push(ex.id);
      } else {
        ex.name = to; ex.metric = "cardio"; ex.category = "cardio";
        target = ex;
      }
      myWorkouts().forEach(function (wk) {
        wk.exercises.forEach(function (blk) {
          if (blk.exerciseId !== ex.id) return;
          var secs = 0, dist = 0, hasD = false, unit = null;
          blk.sets.forEach(function (st) {
            if (st.seconds) secs += st.seconds;
            if (st.distance != null) { dist += st.distance; hasD = true; unit = unit || st.distUnit; }
          });
          blk.exerciseId = target.id;
          blk.metric = "cardio";
          delete blk.equipment;
          blk.sets = [{ reps: null, seconds: secs || null, weight: null, distance: hasD ? Math.round(dist * 100) / 100 : null,
            unit: "lb", distUnit: unit || "mi", intensity: null, heartRate: null, steps: null }];
        });
      });
      changed = true;
    });
    return changed;
  }

  function findOrCreateExercise(name) {
    var found = exerciseByKey(name);
    if (found) return found;
    var exObj = {
      id: uid("ex"), name: name,
      category: EXERCISE_CATEGORIES[name] || "other",
      metric: DEFAULT_METRIC[name] || "reps"
    };
    state.exercises.push(exObj);
    return exObj;
  }

  /* The same clean-up for what was already logged: "Dumbbell Bicep Curls"
     sessions become Bicep Curl sessions with Dumbbell selected, and the old
     name drops out of the picker. Safe to run on every open. */
  function migrateExerciseNames() {
    var changed = false;
    state.settings.retiredExercises = state.settings.retiredExercises || [];
    state.exercises.slice().forEach(function (ex) {
      if (retiredExercise(ex.id)) return;
      var parsed = parseExerciseName(ex.name);
      if (!parsed || exerciseKey(parsed.base) === exerciseKey(ex.name)) return;
      var target = exerciseByKey(parsed.base);
      if (target && target.id === ex.id) return;
      if (!target) {
        // nothing to merge into: just drop the equipment from the name
        ex.name = parsed.base;
        target = ex;
      } else {
        state.settings.retiredExercises.push(ex.id);
      }
      ensureEquipment(parsed.equipment);
      myWorkouts().forEach(function (wk) {

        wk.exercises.forEach(function (blk) {
          if (blk.exerciseId !== ex.id) return;
          blk.exerciseId = target.id;
          if (!blk.equipment) blk.equipment = parsed.equipment;
        });
      });
      changed = true;
    });
    // an exercise retired earlier can come back from another phone's sync
    var retired = state.settings.retiredExercises;
    if (retired.length) {
      myWorkouts().forEach(function (wk) {
        wk.exercises.forEach(function (blk) {
          if (retired.indexOf(blk.exerciseId) === -1) return;
          var old = findExercise(blk.exerciseId);
          var parsed = old && parseExerciseName(old.name);
          var target = parsed && exerciseByKey(parsed.base);
          if (!target) return;
          blk.exerciseId = target.id;
          if (!blk.equipment) blk.equipment = parsed.equipment;
          changed = true;
        });
      });
    }
    return changed;
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

    var parsed = parseExerciseName(query);
    var matches = state.exercises
      .filter(function (e) {
        return !retiredExercise(e.id) && e.metric !== "cardio" && e.name.toLowerCase().indexOf(q) !== -1;
      })
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

    var exact = state.exercises.some(function (e) { return !retiredExercise(e.id) && e.name.toLowerCase() === q; });
    var listEl = document.getElementById("exercise-modal-list");

    var html = "";
    if (parsed && !exact) {
      var known = exerciseByKey(parsed.base);
      html += '<button class="picker-row is-create is-parsed" data-pick-parsed="1">' +
        '<span class="create-plus">' + (known ? "&rsaquo;" : "+") + '</span> ' + esc(known ? known.name : parsed.base) +
        '<span class="eq-chip">' + esc(parsed.equipment) + '</span>' +
        '<span class="picker-sub">' + (known ? "Logs as " + esc(known.name) : "New exercise") +
          ' with ' + esc(parsed.equipment) + ' selected</span></button>';
    }
    // nothing typed yet, or typed something new -> offer to add it inline
    if (q && !exact && !parsed) {
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
    var parsedBtn = listEl.querySelector("[data-pick-parsed]");
    if (parsedBtn) parsedBtn.addEventListener("click", function () {
      var exObj = findOrCreateExercise(parsed.base);
      ensureEquipment(parsed.equipment);
      persist();
      pickExercise(exObj, parsed.equipment);
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
      var n = myWorkouts().filter(function (w) { return w.gymId === g.id; }).length;
      openConfirm({
        title: "Remove " + g.name + "?",
        body: n
          ? n + (n === 1 ? " session loses its check-in" : " sessions lose their check-in") +
            ". The sessions themselves are kept."
          : "Nothing is checked in here yet.",
        confirmLabel: "Remove gym",
        onConfirm: function () {
          myWorkouts().forEach(function (w) { if (w.gymId === g.id) w.gymId = null; });
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
    renderHomeDay();
  }

  /* The selected day, under the calendar: did you train, and who else did.
     Every entry is a full-width row; tapping one opens that session. If you
     logged nothing that day, your row is the way to log it, already dated. */
  /* A workout is already half-typed: offer to carry on with it, or start
     fresh -- and only ask about discarding once they pick fresh. */
  function openDraftChoice(dayName, startNew) {
    var p = (draft.date || "").split("-");
    var when = p.length === 3
      ? calendarDate(new Date(+p[0], +p[1] - 1, +p[2]).toISOString()) : "";
    var n = (draft.exercises || []).length;
    var sets = (draft.exercises || []).reduce(function (sum, ex) {
      return sum + (ex.sets || []).filter(function (st) {
        return st.reps || st.seconds || st.weight || st.distance;   // filled in, not blank rows
      }).length;
    }, 0);
    var el = openListSheet("Workout in progress",
      '<div class="draft-card">' +
        '<span class="draft-card-name">' + esc(draft.title || "Untitled workout") + '</span>' +
        '<span class="person-sub">' + [when,
          n + (n === 1 ? " exercise" : " exercises"),
          sets ? sets + (sets === 1 ? " set" : " sets") : null]
          .filter(Boolean).map(esc).join(" &middot; ") + '</span>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="draft-continue">Keep editing it</button>' +
      '<button class="btn btn-ghost btn-block" id="draft-new" style="margin-top:8px;">Start a new one for ' +
        esc(dayName) + '</button>');
    el.querySelector("#draft-continue").addEventListener("click", function () {
      closeListSheet();
      activateTab("log");
    });
    el.querySelector("#draft-new").addEventListener("click", function () {
      closeListSheet();
      openConfirm({
        title: "Discard your unsaved workout?",
        body: "\u201c" + (draft.title || "Untitled workout") + "\u201d will be deleted. This can\u2019t be undone.",
        confirmLabel: "Discard",
        onConfirm: startNew
      });
    });
  }

  function renderHomeDay() {
    var el = document.getElementById("home-day");
    var key = selectedDayKey || localDayKey(new Date().toISOString());
    var d = dateFromDayKey(key);
    var iso = d.toISOString();
    var isToday = key === localDayKey(new Date().toISOString());
    var isFuture = d > new Date(new Date().setHours(23, 59, 59, 999));
    var dayName = isToday ? "Today" : calendarDate(iso);

    var mine = myWorkouts().filter(function (wk) { return localDayKey(wk.performedAt) === key; })
      .sort(function (a, b) { return new Date(a.performedAt) - new Date(b.performedAt); });

    var friends = friendsOf(state.me.id);
    var theirs = [];
    friends.forEach(function (u) {
      workoutsOf(u.id).forEach(function (wk) {
        if (localDayKey(wk.performedAt) === key) theirs.push({ user: u, wk: wk });
      });
    });
    theirs.sort(function (a, b) { return new Date(b.wk.performedAt) - new Date(a.wk.performedAt); });

    var trainedIds = {};
    theirs.forEach(function (r) { trainedIds[r.user.id] = true; });
    var count = Object.keys(trainedIds).length;

    var row = function (user, who, wk, extra) {
      var gymObj = wk.gymId ? findGym(wk.gymId) : null;
      return '<button class="home-day-row" data-day-workout="' + wk.id + '">' +
        (user.id === state.me.id ? avatarHtml(user)
          : '<span class="profile-tap" data-profile="' + esc(user.id) + '">' + avatarHtml(user) + '</span>') +
        '<span class="person-body">' +
          '<span class="person-name">' + esc(who) + ' <span class="home-day-title">' +
            workoutTitleHtml(wk) + '</span></span>' +
          '<span class="person-sub">' +
            [esc(formatTime(wk.performedAt)), gymObj ? esc(gymLabel(gymObj)) : null]
              .concat(extra || []).concat(sessionFacts(wk).map(esc))
              .filter(Boolean).join(' &middot; ') +
          '</span></span>' +
        '<span class="chevron">&rsaquo;</span></button>';
    };

    /* A friend's workout gets the reaction bar, same as the feed, so you can
       react without leaving Home. Yours shows what people sent you. */
    var card = function (user, who, wk) {
      var isMe = user.id === state.me.id;
      var below = isMe ? receivedReactionsHtml(wk) : reactionBarHtml(wk);
      return '<div class="home-day-card">' + row(user, who, wk) + below + '</div>';
    };

    var html = '<div class="home-day-head"><span class="home-day-name">' + esc(dayName) + '</span>' +
      (friends.length
        ? '<span class="home-day-count">' + count + ' of ' + friends.length +
            (friends.length === 1 ? ' friend' : ' friends') + ' trained</span>'
        : '') + '</div>';

    html += mine.length
      ? mine.map(function (wk) { return card(state.me, "You", wk); }).join("")
      : (isFuture ? ""
          : '<button class="home-day-row is-log" id="day-log">' +
              '<span class="home-day-plus">+</span>' +
              '<span class="person-body">' +
                '<span class="person-name">' + (isToday ? "You haven\u2019t logged today" : "You didn\u2019t log this day") + '</span>' +
                '<span class="person-sub">Tap to log a workout for ' + esc(isToday ? "today" : calendarDate(iso)) + '</span>' +
              '</span><span class="chevron">&rsaquo;</span></button>');

    html += theirs.map(function (r) { return card(r.user, r.user.name, r.wk); }).join("");

    if (!friends.length) {
      html += '<button class="home-day-row is-muted" id="day-add-friends"' +
          (signedOut() ? ' data-open-auth="signin"' : '') + '>' +
        '<span class="person-body"><span class="person-sub">' +
          (signedOut() ? "Sign in to see who trained" : "Add friends to see who trained") +
        '</span></span>' +
        '<span class="chevron">&rsaquo;</span></button>';
    } else if (!theirs.length) {
      html += '<div class="home-day-empty">' +
        (isFuture ? "Nothing logged yet." : "Nobody you follow logged " + (isToday ? "yet today." : "this day.")) + '</div>';
    }

    el.innerHTML = html;
    wireReactions(el, function () { renderHomeDay(); renderFriends(); });

    el.querySelectorAll("[data-day-workout]").forEach(function (b) {
      b.addEventListener("click", function () { openWorkoutDetail(b.getAttribute("data-day-workout")); });
    });
    var logBtn = el.querySelector("#day-log");
    if (logBtn) logBtn.addEventListener("click", function () {
      var start = function () {
        resetDraft();
        draft.date = dateInputValue(iso);
        activateTab("log");
        if (!isToday) showToast("Logging for " + calendarDate(iso) + ".");
      };
      // never throw away a workout someone is halfway through typing
      saveDraft();
      if (!draftHasContent(draft)) { start(); return; }
      openDraftChoice(isToday ? "today" : calendarDate(iso), start);
    });
    var addBtn = el.querySelector("#day-add-friends");
    if (addBtn && !signedOut()) addBtn.addEventListener("click", function () { activateTab("friends"); });
  }

  /* ----------------------------- profile ----------------------------- */

  /* Everything that is "you over time": who you are, the all-time numbers,
     your gyms and your whole history. Home stays about today. */
  /* Your profile is your account: signed out, there is nothing to show
     yet but the way in. */
  var PERSON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>';

  function renderProfile() {
    var out = signedOut();
    var gate = document.getElementById("profile-signin");
    gate.hidden = !out;
    document.getElementById("profile-body").hidden = out;
    if (out) {
      gate.innerHTML = '<div class="signin-card">' +
        '<div class="signin-card-icon">' + PERSON_SVG + '</div>' +
        '<div class="signin-card-title">Sign in to see your profile</div>' +
        '<p class="signin-card-text">Pick a username, add a photo, and let your friends find you.</p>' +
        '<button class="btn btn-primary btn-block" id="profile-sign-in" data-open-auth="signin">Sign in</button>' +
        '<button class="btn btn-ghost btn-block" data-open-auth="signup" style="margin-top:8px;">Create account</button>' +
      '</div>';
      return;
    }
    var me = state.me;
    var mine = myWorkouts();
    var streak = computeStreak(me.id);
    var first = mine.slice().sort(function (a, b) {
      return new Date(a.performedAt) - new Date(b.performedAt);
    })[0];

    document.getElementById("profile-head").innerHTML =
      avatarHtml(me, "is-big") +
      '<div class="profile-name">' + esc(me.name) + '</div>' +
      (currentUser() && me.handle ? '<div class="profile-handle">@' + esc(me.handle) + '</div>' : '') +
      '<div class="profile-actions">' +
        '<button class="btn btn-ghost" id="pick-photo">' +
          (me.avatar ? "Change photo" : "Add photo") + '</button>' +
        (me.avatar ? '<button class="btn btn-ghost" id="drop-photo">Remove</button>' : '') +
        '<button class="btn btn-ghost" id="rename-me">Rename</button>' +
        (currentUser() ? '<button class="btn btn-ghost" id="set-username">Username</button>' : '') +
        (currentUser() && me.handle ? '<button class="btn btn-primary" id="share-me">Share profile</button>' : '') +
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
    var shareBtn = document.getElementById("share-me");
    if (shareBtn) shareBtn.addEventListener("click", function () { shareProfile(state.me); });
    var unameBtn = document.getElementById("set-username");
    if (unameBtn) unameBtn.addEventListener("click", openUsername);

    renderGyms();
    renderProfileWorkouts(mine, true);
  }

  /* The name is edited in a dialog rather than a live field: a text input
     that re-renders the screen on blur is how you tear it out mid-event. */
  function openRename() {
    var el = openListSheet("Display name",
      '<input type="text" id="rename-input" value="' + esc(state.me.name) + '" placeholder="Your name">' +
      '<p class="setting-help">Shown on your sessions and to your friends.</p>' +
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
      if (currentTab === "settings") renderSettings();
    });
  }


  /* Your @handle is how friends search for you, so it gets the same rules
     the database enforces: lowercase letters, numbers, _ and . only. */
  function openUsername() {
    var el = openListSheet("Username",
      '<div class="handle-field"><span>@</span>' +
        '<input type="text" id="username-input" value="' + esc(state.me.handle || "") + '" ' +
          'autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="20"></div>' +
      '<p class="setting-help" id="username-note">3\u201320 characters: lowercase letters, numbers, _ and . ' +
        'Friends find you by this.</p>' +
      '<button class="btn btn-primary btn-block" id="username-save">Save</button>');

    var input = el.querySelector("#username-input");
    var note = el.querySelector("#username-note");
    var save = el.querySelector("#username-save");
    input.focus();
    input.addEventListener("input", function () {
      // nudge toward a valid name as you type instead of rejecting it later
      var clean = input.value.toLowerCase().replace(/[^a-z0-9_.]/g, "");
      if (clean !== input.value) input.value = clean;
    });
    save.addEventListener("click", function () {
      var v = input.value.trim();
      if (v === state.me.handle) { closeListSheet(); return; }
      if (!USERNAME_RULE.test(v)) { note.textContent = "Use 3\u201320 lowercase letters, numbers, _ or ."; return; }
      save.disabled = true;
      setUsername(v)
        .then(function (name) {
          closeListSheet();
          renderProfile();
          if (currentTab === "settings") renderSettings();
          showToast("You're @" + name + " now.");
        })
        .catch(function (err) {
          save.disabled = false;
          note.textContent = (err && err.message) || "Couldn't save that. Try again.";
        });
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
            '<span class="log-title" style="display:block;">' + esc(wk.title || "Workout") +
              reactionSummaryHtml(wk) + '</span>' +
            '<span class="log-meta" style="display:block;">' +
              [esc(formatTime(wk.performedAt))]
                .concat(gymObj ? [esc(gymLabel(gymObj))] : [])
                .concat(sessionFacts(wk).map(esc))
                .concat([exCount + (exCount === 1 ? " exercise" : " exercises")])
                .join(' &middot; ') +
            '</span>' +
            '<span class="exercise-chips">' + exerciseChipsHtml(wk) + '</span>' +
          '</span>' +
          (photoSrc(wk)
            ? '<img class="log-thumb" src="' + esc(photoSrc(wk)) + '" alt="" loading="lazy">'
            : '') +
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


  document.getElementById("progress-search").addEventListener("input", function (e) {
    progressQuery = e.target.value;
    renderProgress();
  });

  /* ----------------------------- weight bump chips ----------------------------- */

  /* Typing 187.5 is slower than tapping +2.5. The chips sit right under the
     weight box you're in, inside the page -- not pinned above the keyboard,
     which depended on iPhone reporting the keyboard's height and mostly
     didn't. Steps follow the unit, since 2.5kg is not a plate anyone owns. */
  var BUMPS = { lb: [2.5, 5, 10], kg: [1.25, 2.5, 5] };
  var bumpTarget = null;

  function bumpSteps(input) {
    var row = input && input.closest(".set-row");
    var toggle = row && row.querySelector("[data-unit-toggle]");
    return BUMPS[toggle && toggle.textContent.trim() === "kg" ? "kg" : "lb"];
  }

  function hideBumpRow() {
    document.querySelectorAll(".bump-row").forEach(function (r) { r.remove(); });
    bumpTarget = null;
  }

  function applyBump(delta) {
    if (!bumpTarget) return;
    var now = parseFloat(bumpTarget.value);
    var next = Math.max(0, (isNaN(now) ? 0 : now) + delta);
    bumpTarget.value = Math.round(next * 100) / 100;
    bumpTarget.dispatchEvent(new Event("input", { bubbles: true }));
    buzz(8);
  }

  function showBumpRow(input) {
    var row = input.closest(".set-row");
    if (!row) return;
    if (bumpTarget === input && row.nextElementSibling &&
        row.nextElementSibling.classList.contains("bump-row")) return;
    hideBumpRow();
    bumpTarget = input;
    var steps = bumpSteps(input);
    var bar = document.createElement("div");
    bar.className = "bump-row";
    bar.innerHTML = [-steps[0], steps[0], steps[1], steps[2]].map(function (d) {
      return '<button type="button" class="bump-chip" data-delta="' + d + '">' +
        (d < 0 ? "\u2212" + (-d) : "+" + d) + '</button>';
    }).join("");
    row.insertAdjacentElement("afterend", bar);

    bar.querySelectorAll("[data-delta]").forEach(function (chip) {
      var delta = Number(chip.getAttribute("data-delta"));
      // act on the touch itself and cancel it: that keeps the weight box
      // focused (and the keyboard up) instead of tapping it away
      chip.addEventListener("touchstart", function (e) {
        e.preventDefault();
        applyBump(delta);
      }, { passive: false });
      chip.addEventListener("mousedown", function (e) { e.preventDefault(); });
      chip.addEventListener("click", function () { applyBump(delta); });
    });
  }

  document.addEventListener("focusin", function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute("data-bump-ok") === "1") showBumpRow(t);
  });
  // Hidden a beat after you leave the box, never on the press itself: taking
  // the row out mid-tap would shift the page and the tap would miss its button.
  document.addEventListener("focusout", function () {
    setTimeout(function () {
      var a = document.activeElement;
      if (!(a && a.getAttribute && a.getAttribute("data-bump-ok") === "1")) hideBumpRow();
    }, 300);
  });

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
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "open-url") openFromUrl(e.data.url);
    });
  }
  if (restoreDraft()) {
    document.getElementById("log-title").value = draft.title || "";
    document.getElementById("log-calories").value = draft.calories || "";
    renderLog();
    showToast("Picked your workout back up.");
  }
  migrateExerciseNames();
  migrateCardio();
  persist();
  renderHome();

  /* Accounts + sync. After a pull brings in changes from another phone,
     redraw whatever is on screen -- except mid-edit, where it would wipe
     what you're typing. */
  var wasAuthed = false;
  if (/[?&](workout|friends|inbox|add)=/.test(location.search)) setTimeout(function () { openFromUrl(location.href); }, 0);

  startSync({
    getState: function () { return state; },
    onChange: function () {
      if (migrateExerciseNames() | migrateCardio()) persist();   // a pull can bring an old name back
      if (pendingWorkout && state.workouts.some(function (w) { return w.id === pendingWorkout; })) {
        var wid = pendingWorkout;
        pendingWorkout = null;
        setTimeout(function () { openWorkoutDetail(wid); }, 0);
      }
      applyTheme();
      renderBell();
      if (editingId || currentTab === "log") return;
      activateTab(currentTab);
    },
    onStatus: function () {
      authResolved = true;
      processPendingAdd();
      if (pendingInbox) { pendingInbox = false; openInbox(); }
      renderBell();
      var authed = !!currentUser();
      if (authed !== wasAuthed) {
        wasAuthed = authed;
        if (!editingId && currentTab !== "log") activateTab(currentTab);
        return;
      }
      var line = document.getElementById("sync-line");
      if (line) line.textContent = syncLine();
      else if (currentTab === "settings") renderSettings();
    }
  });
})();
