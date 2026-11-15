/**
 * Cardio: what each activity records, how a run or ride is summarised, and the
 * cardio entry form.
 */

import {
  closeListSheet, durationOf, esc, findExercise, formatDuration, joinDuration, lastSessionFor,
  myWorkouts, openListSheet, pad2, persist, shortDate, showToast, splitDuration, state,
  titleCase, uid
} from "./core.js";
import { draft, exerciseKey, renderLog, retiredExercise } from "./log.js";

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

export function activityProfile(name) {
  return CARDIO_PROFILES[name] || CARDIO_GENERIC;
}

// 8:13 /mi, 7.3 mph, 2:05 /500m -- or "" when there isn't enough to say
export function cardioRate(st, profile) {
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
export function cardioSummary(st, name, full) {
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
export function cardioTiles(wk) {
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

export function isCardioWorkout(wk) {
  return !!(wk && wk.exercises && wk.exercises.length &&
    wk.exercises.every(function (b) { return b.metric === "cardio"; }));
}

export function cardioIconFor(wk) {
  var ex = wk && wk.exercises[0] && findExercise(wk.exercises[0].exerciseId);
  return activityProfile(ex ? ex.name : "").icon;
}
// a heartbeat line: marks a cardio day on the calendar, where lifting gets a flame
export var CARDIO_MARK_SVG = '<svg class="cal-flame cal-cardio" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l3-7 4 14 3-7h6"/></svg>';

/* One activity: what it was, then its numbers. On a Cardio post the
   activity rail is the header; as a finisher inside a lift it has a name
   and a Remove like any exercise. */
export function cardioBlockHtml(blk, i, exObj, standalone, excludeWorkoutId) {
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

export function wireCardioBlocks(containerEl, draftObj, rerender, excludeWorkoutId) {
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

// start where you usually start: the activity you logged most recently
export function lastActivityName() {
  var last = myWorkouts().filter(isCardioWorkout).sort(function (a, b) {
    return new Date(b.performedAt) - new Date(a.performedAt);
  })[0];
  var ex = last && findExercise(last.exercises[0].exerciseId);
  return ex ? ex.name : "Run";
}

/* Cardio activities are exercises too (so history, charts and sync all
   just work), marked metric "cardio". Made the first time they're used. */
export function ensureActivity(name) {
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
export function cardioBlockFor(exObj, excludeWorkoutId) {
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

export function migrateCardio() {
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

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls this in a fixed order. */

export function startCardio() {
  document.getElementById("add-cardio-btn").addEventListener("click", function () {
    openCardioPicker(function (act) {
      draft.exercises.push(cardioBlockFor(act, null));
      renderLog();
    });
  });
}
