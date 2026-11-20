/**
 * Logging: the Log screen, exercise blocks and sets, the exercise picker,
 * editing a workout, reusing one, photos and the after-save summary.
 */

import { adoptGym, cloudEnabled, currentUser, photoSrc, shrinkPhoto } from "./store.js";
import {
  activateTab, avatarHtml, buzz, calendarDate, closeListSheet, computeStreak, dateInputValue,
  DEFAULT_EQUIPMENT, DEFAULT_METRIC, defaultUnit, detectPRs, dropsWeight, durationOf,
  endIsoFrom, equipmentList, esc, EXERCISE_CATEGORIES, featureOn, findExercise, findGym,
  findUser, FLAME_SVG, formatDuration, formatDurationLong, formatTime, friendsOf, gymAddress,
  exerciseKey, gymLabel, isoFromDateTime, joinDuration, lastSessionFor, singularWord, loggedSetTime, metricOf, METRICS,
  myWorkouts, openConfirm, openListSheet, persist, repSetCount, sessionDistance, sessionVolume,
  shortDate, showToast, splitDuration, state, summarizeSets, tabBeforeLog, timeInputValue,
  titleCase, uid, usesDuration, usesEquipment, weightLabel, workoutById
} from "./core.js";
import {
  cardioBlockFor, cardioBlockHtml, cardioTiles, ensureActivity, isCardioWorkout,
  lastActivityName, wireCardioBlocks
} from "./cardio.js";
import { openShareCard } from "./feed.js";
import { wireDragReorder } from "./gestures.js";
import { goalsReachedBy } from "./goals.js";
import { knownGym, openGymFinder } from "./gyms.js";
import { openDraftChoice, renderHome } from "./home.js";
import { renderLogLive, startLive, stopLive, todayInput } from "./live.js";
import { setSelectedExerciseId } from "./progress.js";
import { maybeAskNotifications, openSettings } from "./settings.js";

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

  // a strength goal this workout just reached (said once, here)
  var reached = goalsReachedBy(workout);
  if (reached.length) {
    html += '<div class="pr-banner">' +
      FLAME_SVG.replace("streak-flame", "pr-flame") +
      '<div><div class="pr-banner-title">' + (reached.length === 1 ? "Goal reached" : reached.length + " goals reached") + '</div>' +
        reached.map(function (g) {
          return '<div class="pr-line">' + esc(g.name) + ' <span class="num">' + esc(g.text) + '</span> estimated 1RM</div>';
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
    '<button class="btn btn-primary btn-block" id="summary-done" style="margin-top:16px;">Done</button>' +
    '<button class="btn btn-ghost btn-block" id="summary-share" style="margin-top:8px;">Share as a picture</button>';

  var el = openListSheet("Nice work", html);
  el.querySelector("#summary-done").addEventListener("click", closeListSheet);
  el.querySelector("#summary-share").addEventListener("click", function () { openShareCard(workout.id); });

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

/* ---------- reuse a workout ---------- */

/* Starts today's workout as a copy: same exercises and equipment, every
   set filled in (lighter, like a suggestion) with that workout's numbers.
   A friend's exercises are matched to yours by name. */
/* A tag you've answered (added or dismissed) stops offering its buttons.
   Kept in settings so it's settled on your other phone too; only tags
   still in the Inbox are remembered, so the list can't grow forever. */
export function settleTag(workoutId) {
  var live = {};
  (state.inbox || []).forEach(function (it) { if (it.kind === "tag") live[it.workoutId] = true; });
  var done = {};
  Object.keys(state.settings.tagsDone || {}).forEach(function (id) { if (live[id]) done[id] = true; });
  done[workoutId] = true;
  state.settings.tagsDone = done;
  persist();
}

/* "Add to my log" on a workout a friend tagged you in: the same session,
   so it keeps their date, time and gym, tags them back along with anyone
   else who was there, and fills in their numbers as a starting point. */
export function addTaggedToLog(workoutId) {
  var wk = workoutById(workoutId);
  if (!wk) return;
  startReuse(wk, { sameSession: true });
}

/* An exercise from any workout -- yours or a friend's -- as a block for
   one of yours: matched to your own exercise of that name, its numbers as
   the lighter suggestions. null if the exercise can't be named. */
export function copyBlock(blk, mine) {
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
      var o = { reps: st.reps == null ? null : st.reps, seconds: st.seconds == null ? null : st.seconds,
        weight: st.weight == null ? null : st.weight, distance: st.distance == null ? null : st.distance,
        unit: st.unit || "lb", distUnit: st.distUnit || "mi",
        intensity: st.intensity == null ? null : st.intensity,
        heartRate: st.heartRate == null ? null : st.heartRate,
        steps: st.steps == null ? null : st.steps, prefill: true };
      if (st.drop) o.drop = true;
      return o;
    })
  };
  if (blk.superset) out.superset = blk.superset;
  return out;
}

/* Swipe an exercise in any workout and tap "Add to workout": it joins the
   one you're logging (or starts one), and you stay where you were. */
export function addBlockToDraft(wk, index) {
  var blk = wk && wk.exercises[index];
  var out = blk ? copyBlock(blk, wk.userId === state.me.id) : null;
  if (!out) { showToast("Couldn’t copy that one."); return; }
  delete out.superset;
  var ex = findExercise(out.exerciseId);
  if (draft.kind === "cardio") {
    var cur = draft.exercises[0];
    var untouched = !cur || cur.sets.every(function (st) {
      return st.prefill || (st.seconds == null && st.distance == null && st.steps == null && st.heartRate == null);
    });
    if (out.metric === "cardio" && untouched) draft.exercises = [];
    else setLogKind("lift");
  }
  draft.exercises.push(out);
  persist();
  saveDraft();
  renderFab();
  showToast("Added " + (ex ? ex.name : "it") + " to your workout.");
}

export function startReuse(wk, opts) {
  var go = function () {
    var mine = wk.userId === state.me.id;
    resetDraft();
    draft.kind = isCardioWorkout(wk) ? "cardio" : "lift";
    draft.title = wk.title || "";
    // into the box now: rendering the log saves the draft from what's on screen
    document.getElementById("log-title").value = draft.title;
    if (wk.gymId && state.gyms.some(function (g) { return g.id === wk.gymId; })) draft.gymId = wk.gymId;
    draft.exercises = wk.exercises.map(function (blk) { return copyBlock(blk, mine); }).filter(Boolean);
    if (opts && opts.sameSession) {
      draft.date = dateInputValue(wk.performedAt);
      draft.startTime = timeInputValue(wk.performedAt);
      draft.endTime = wk.endedAt ? timeInputValue(wk.endedAt) : "";
      var theirGym = wk.gymId ? knownGym(wk.gymId) : null;
      if (theirGym) draft.gymId = adoptGym(theirGym).id;
      var friendIds = friendsOf(state.me.id).map(function (u) { return u.id; });
      draft.withIds = [wk.userId].concat(wk.withIds || []).filter(function (id, i, all) {
        return id !== state.me.id && friendIds.indexOf(id) !== -1 && all.indexOf(id) === i;
      });
    }
    persist();
    closeListSheet();
    activateTab("log");
    renderLog();
    showToast(opts && opts.sameSession
      ? "Added from " + ((findUser(wk.userId) || {}).name || "your friend").split(" ")[0] +
        "’s workout — change anything that was different for you."
      : "Reusing “" + (wk.title || "Workout") + "” — type over any number to change it.");
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

/* ----------------------------- feed ----------------------------- */

/* ----------------------------- edit workout ----------------------------- */

export var editingId = null;
export var editDraft = { gymId: "", exercises: [] };

export function openEditWorkout(workoutId, focusIndex) {
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
          var o = {
            reps: s.reps, seconds: s.seconds, weight: s.weight, distance: s.distance,
            unit: s.unit || "lb", distUnit: s.distUnit || "mi"
          };
          if (s.drop) o.drop = true;
          return o;
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
  if (focusIndex != null) {
    var target = document.querySelectorAll("#edit-exercise-blocks .exercise-block")[focusIndex];
    if (target) {
      setTimeout(function () {
        target.scrollIntoView({ block: "center" });
        target.classList.add("is-flash");
        setTimeout(function () { target.classList.remove("is-flash"); }, 1400);
      }, 220);
    }
  }
}

function closeEditWorkout() {
  document.getElementById("edit-modal-overlay").classList.remove("open");
  editingId = null;
}

export function renderEditModal() {
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

/* ----------------------------- log ----------------------------- */

var DRAFT_KEY = "gymsocial_draft_v1";
export var draft = { gymId: "", exercises: [] };

/* "My gym" if you set one, otherwise the first on your list. */
function defaultGymId() {
  var home = state.settings.homeGymId;
  if (home && state.gyms.some(function (g) { return g.id === home; })) return home;
  return state.gyms[0] ? state.gyms[0].id : "";
}

function freshDraft() {
  return {
    kind: "lift",          // "cardio" = one activity, posted on its own
    stash: null,           // the other mode's entries, kept while you flip
    gymId: defaultGymId(),
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

export function resetDraft() {
  stopLive();               // saved, cancelled or started over: you're no longer "at the gym"
  draft = freshDraft();
  ["log-title", "log-calories"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = "";
  });
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ }
  renderFab();
}

/* The + in the tab bar: a plus when there's nothing started, a dumbbell
   with a green dot while a workout is half logged, so it's plain that
   tapping it goes back to that workout rather than starting a new one. */
export function renderFab() {
  var fab = document.querySelector(".tab-fab");
  if (!fab) return;
  // anything at all started counts: an exercise or cardio block (even one
  // still showing last time's numbers), a title, a photo, a tagged friend
  var on = Boolean(draftHasContent(draft) || (draft.exercises || []).length || (draft.withIds || []).length);
  fab.classList.toggle("has-draft", on);
  fab.setAttribute("aria-label", on ? "Continue your workout" : "Log a workout");
}

/* A half-logged session used to live only in memory, so swiping the app
   away lost it. It is written out on every change now and picked back up
   on the next open. */
/* The title and calories live in plain inputs rather than on the draft,
   so they are read in at save time -- otherwise a restore brings back the
   sets but not what you called the session. */
/* An untouched cardio form isn't "a workout in progress" -- only what you
   typed is. Lift exercises count as soon as they're added. */
export function draftHasContent(d) {
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

export function saveDraft() {
  var t = document.getElementById("log-title");
  var c = document.getElementById("log-calories");
  if (t) draft.title = t.value;
  if (c) draft.calories = c.value;
  try {
    if (!draftHasContent(draft)) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (e) { /* storage full or blocked -- the session still works */ }
  renderFab();
}

export function restoreDraft() {
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
    withIds: Array.isArray(saved.withIds) ? saved.withIds : [],
    exercises: saved.exercises
  };
  renderFab();
  return true;
}

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
export function supersetLabels(exercises) {
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

export var DRAG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 8h14M5 12h14M5 16h14"/></svg>';
var MORE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';

/* Move one exercise from one place to another. A superset only survives
   if its members are still next to each other. */
function moveBlock(draftObj, from, to) {
  var b = draftObj.exercises.splice(from, 1)[0];
  draftObj.exercises.splice(to, 0, b);
  normalizeSupersets(draftObj.exercises);
}

/* ⋯ on an exercise: move it, copy it, or take it out. */
function openExerciseMenu(draftObj, i, rerender) {
  var blk = draftObj.exercises[i];
  var ex = findExercise(blk.exerciseId);
  var n = draftObj.exercises.length;
  var item = function (act, label, cls, off) {
    return '<button class="menu-row' + (cls ? " " + cls : "") + '" data-menu="' + act + '"' + (off ? " disabled" : "") + '>' + label + '</button>';
  };
  var el = openListSheet(ex ? ex.name : "Exercise",
    '<div class="menu-list">' +
      item("up", "Move up", "", i === 0) +
      item("down", "Move down", "", i === n - 1) +
      item("dup", "Duplicate") +
      item("remove", "Remove exercise", "is-danger") +
    '</div>' +
    (n > 1 ? '<p class="setting-help">Or hold the &#8801; handle and drag it.</p>' : ''));
  el.querySelectorAll("[data-menu]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var act = btn.getAttribute("data-menu");
      if (act === "up") moveBlock(draftObj, i, i - 1);
      else if (act === "down") moveBlock(draftObj, i, i + 1);
      else if (act === "dup") {
        var copy = JSON.parse(JSON.stringify(blk));
        delete copy.superset;
        draftObj.exercises.splice(i + 1, 0, copy);
      } else if (act === "remove") {
        draftObj.exercises.splice(i, 1);
        normalizeSupersets(draftObj.exercises);    // removal can orphan a group too
      }
      closeListSheet();
      rerender();
    });
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

    // dumbbell and cable numbers aren't comparable, so "last time" is on
    // the equipment picked here (sessions from before equipment was a
    // choice count for any of them)
    var onEquip = usesEquipment(metric) && blk.equipment ? blk.equipment : undefined;
    var last = lastSessionFor(blk.exerciseId, excludeWorkoutId, onEquip);
    var everLogged = onEquip !== undefined && !last && lastSessionFor(blk.exerciseId, excludeWorkoutId);
    var lastLine = last
      ? '<div class="last-time">Last time' + (onEquip ? " on " + esc(onEquip) : "") + ' <strong>' +
          esc(summarizeSets(last.block.sets, metricOf(last.block), last.block.equipment, exObj && exObj.name)) +
          '</strong> &middot; ' + shortDate(last.workout.performedAt) + '</div>'
      : '<div class="last-time is-new">' + (everLogged ? "First time on " + esc(onEquip) : "First time logging this") + '</div>';

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
        '<div class="set-row' + (dur ? " has-duration" : "") + (noWt ? " no-weight" : "") + (s.drop ? " is-drop" : "") +
            '" data-ex="' + i + '" data-set="' + si + '">' +
          // a drop set shows an arrow where its number would be; tapping it makes the set a normal one again
          (s.drop
            ? '<button type="button" class="set-index is-drop" data-drop-off="' + i + ':' + si +
                '" aria-label="Drop set. Tap to make it a normal set">↓</button>'
            : '<span class="set-index">' + (si + 1) + '</span>') +
          firstCell +
          weightCells +
          '<button class="set-remove" data-remove-set="' + si + '" data-remove-set-ex="' + i + '" aria-label="Remove set ' + (si + 1) + '">&times;</button>' +
        '</div>';
    }).join("");

    var noteOpen = blk.showNote || (blk.note && blk.note.length);
    var noteHtml = noteOpen
      ? '<div class="note-wrap">' +
          '<textarea class="note-input" rows="2" data-note="' + i + '" placeholder="How did it feel? Form cues, aches...">' + esc(blk.note || "") + '</textarea>' +
          '<button type="button" class="note-clear" data-clear-note="' + i + '" aria-label="Remove note">&times;</button>' +
        '</div>'
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
          (draftObj.exercises.length > 1
            ? '<button type="button" class="drag-handle" data-drag="' + i + '" aria-label="Drag to reorder">' + DRAG_SVG + '</button>' : '') +
          '<h3 class="ex-name" data-rename="' + i + '" title="Tap to rename">' +
            esc(exObj ? exObj.name : "Exercise") + '<span class="ex-pencil">&#9998;</span></h3>' +
          '<button type="button" class="ex-menu-btn" data-ex-menu="' + i + '" aria-label="More for this exercise">' + MORE_SVG + '</button></div>' +
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
          '<span class="foot-links">' +
            '<button class="add-set-link" data-add-set="' + i + '">+ Add set</button>' +
            (metric === "reps" && !noWt
              ? '<button class="add-set-link" data-add-drop="' + i + '">+ Drop set</button>' : "") +
          '</span>' +
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

  containerEl.querySelectorAll("[data-ex-menu]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openExerciseMenu(draftObj, Number(btn.getAttribute("data-ex-menu")), rerender);
    });
  });
  wireDragReorder(containerEl, ".exercise-block", "[data-drag]", function (from, to) {
    moveBlock(draftObj, from, to);
    buzz(8);
    rerender();
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
  // a drop set: straight on from the set before it, with less weight. It
  // starts as a copy of that set so only the weight needs lowering.
  containerEl.querySelectorAll("[data-add-drop]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var blk = draftObj.exercises[Number(btn.getAttribute("data-add-drop"))];
      var last = blk.sets[blk.sets.length - 1] || {};
      blk.sets.push({
        reps: last.reps == null ? null : last.reps, seconds: null,
        weight: last.weight == null ? null : last.weight, distance: null,
        unit: last.unit || defaultUnit(), distUnit: last.distUnit || "mi", drop: true
      });
      rerender();
    });
  });
  containerEl.querySelectorAll("[data-drop-off]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var at = btn.getAttribute("data-drop-off").split(":");
      var st = draftObj.exercises[Number(at[0])].sets[Number(at[1])];
      if (st) delete st.drop;
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
  containerEl.querySelectorAll("[data-clear-note]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var blk = draftObj.exercises[Number(btn.getAttribute("data-clear-note"))];
      blk.note = "";
      blk.showNote = false;
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
  return { reps: null, seconds: null, weight: null, distance: null, unit: unit || defaultUnit(), distUnit: distUnit || "mi" };
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

export function renderLog() {
  renderFab();
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
  renderLogLive();
  renderLogWith();
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

/* ---- who you trained with ----
   Friends only (that's who the database lets you tag), and only shown
   when you have some. They hear about it in their Inbox, with a button
   to add the same workout to their own log. */
function renderLogWith() {
  var field = document.getElementById("log-with-field");
  var friends = featureOn("tags") ? friendsOf(state.me.id) : [];
  field.hidden = !friends.length;
  if (!friends.length) return;
  // anyone no longer a friend quietly drops off
  draft.withIds = (draft.withIds || []).filter(function (id) {
    return friends.some(function (u) { return u.id === id; });
  });
  var box = document.getElementById("log-with");
  box.innerHTML = draft.withIds.map(function (id) {
    var u = findUser(id);
    return '<button type="button" class="with-chip" data-untag="' + esc(id) + '" aria-label="Remove ' + esc(u.name) + '">' +
      avatarHtml(u) + '<span>' + esc(u.name.split(" ")[0]) + '</span><span class="with-x" aria-hidden="true">&times;</span></button>';
  }).join("") + '<button type="button" class="with-add" id="log-with-add">+ Tag a friend</button>';
  box.querySelectorAll("[data-untag]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var id = chip.getAttribute("data-untag");
      draft.withIds = draft.withIds.filter(function (x) { return x !== id; });
      renderLogWith();
      saveDraft();
    });
  });
  box.querySelector("#log-with-add").addEventListener("click", openTagPicker);
}

function openTagPicker() {
  var friends = friendsOf(state.me.id);
  var el = openListSheet("Who did you train with?", "");
  var draw = function () {
    el.innerHTML = friends.map(function (u) {
      var on = (draft.withIds || []).indexOf(u.id) !== -1;
      return '<button class="tag-row' + (on ? " is-on" : "") + '" data-tag-toggle="' + esc(u.id) + '" aria-pressed="' + on + '">' +
        avatarHtml(u) +
        '<span class="person-body"><span class="person-name">' + esc(u.name) + '</span>' +
          '<span class="person-sub">@' + esc(u.handle || "") + '</span></span>' +
        '<span class="tag-check" aria-hidden="true">' + (on ? "✓" : "") + '</span>' +
      '</button>';
    }).join("") +
    '<p class="setting-help">They’ll get it in their Inbox and can add the workout to their own log.</p>' +
    '<button class="btn btn-primary btn-block" id="tag-done" style="margin-top:12px;">Done</button>';
    el.querySelectorAll("[data-tag-toggle]").forEach(function (row) {
      row.addEventListener("click", function () {
        var id = row.getAttribute("data-tag-toggle");
        var list = draft.withIds || [];
        draft.withIds = list.indexOf(id) === -1 ? list.concat([id]) : list.filter(function (x) { return x !== id; });
        draw();
      });
    });
    el.querySelector("#tag-done").addEventListener("click", function () {
      closeListSheet();
      renderLogWith();
      saveDraft();
    });
  };
  draw();
}

function wireLogEvents() {
  document.getElementById("log-gym").onchange = function (e) {
    draft.gymId = e.target.value;
    // choosing a gym for today's workout is the check-in
    if (draft.gymId) startLive(draft.gymId); else stopLive();
    renderLogLive();
  };
  document.getElementById("log-date").onchange = function (e) {
    draft.date = e.target.value;
    if (draft.date !== todayInput()) stopLive();     // logging another day isn't being there now
    renderLogLive();
  };
  document.getElementById("log-start").onchange = function (e) {
    draft.startTime = e.target.value; updateDurationReadout("log", draft);
  };
  document.getElementById("log-end").onchange = function (e) {
    draft.endTime = e.target.value; updateDurationReadout("log", draft);
  };

  document.getElementById("add-gym-btn").onclick = function () {
    openGymFinder(function (g) {
      draft.gymId = g.id;              // picking one from here checks you in
      startLive(g.id);
      renderLog();
      showToast("Checked in at " + gymLabel(g) + ".");
    });
  };

  document.getElementById("add-exercise-btn").onclick = function () {
    openExercisePicker(function (exObj, equip) {
      draft.exercises.push(blockFromLastTime(exObj, null, equip));
      renderLog();
    });
  };

  document.getElementById("finish-workout-btn").onclick = openFinish;

  document.getElementById("save-workout-btn").onclick = function () {
    if (!draft.exercises.length) { showToast("Add at least one exercise first."); return; }
    var cleanExercises = cleanDraftExercises(draft);
    if (!cleanExercises.length) {
      showToast(draft.kind === "cardio" ? "Add a time or distance first." : "Fill in at least one set.");
      return;
    }
    closeFinish();

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
    // saved with the workout so friends' feeds can show the record
    if (prs.length) workout.prs = prs.map(function (p) { return { name: p.name, display: p.display, delta: p.delta || "" }; });
    if (featureOn("tags") && draft.withIds && draft.withIds.length) workout.withIds = draft.withIds.slice();
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

/* Finish workout: everything that only makes sense at the end -- a photo,
   calories from your watch -- in one sheet, then Save. Checks first that
   there's something to save, so the sheet never opens on nothing. */
function openFinish() {
  if (!draft.exercises.length) { showToast("Add at least one exercise first."); return; }
  var clean = cleanDraftExercises(draft);
  if (!clean.length) {
    showToast(draft.kind === "cardio" ? "Add a time or distance first." : "Fill in at least one set.");
    return;
  }
  var title = document.getElementById("log-title").value.trim() ||
    (draft.kind === "cardio" ? ((findExercise(clean[0].exerciseId) || {}).name || "Cardio") : "Workout");
  var start = isoFromDateTime(draft.date, draft.startTime);
  var end = defaultEndIso(draft);
  var secs = end ? Math.round((new Date(end) - new Date(start)) / 1000) : null;
  var sets = repSetCount(clean);
  var bits = [clean.length + (clean.length === 1 ? " exercise" : " exercises")];
  if (sets) bits.push(sets + (sets === 1 ? " set" : " sets"));
  document.getElementById("finish-summary").innerHTML =
    '<div class="finish-title">' + esc(title) + '</div>' +
    '<div class="finish-when">' + esc(calendarDate(start)) + ' &middot; ' + esc(formatTime(start)) +
      (end ? ' &ndash; ' + esc(formatTime(end)) + (secs >= 60 ? ' &middot; ' + esc(formatDurationLong(secs)) : '') : '') +
      ' <button type="button" class="text-link" id="finish-edit-times">Edit</button></div>' +
    '<div class="finish-what">' + esc(bits.join(" \u00b7 ")) + '</div>';
  document.getElementById("finish-edit-times").onclick = function () {
    closeFinish();
    var f = document.getElementById("log-start");
    if (f) f.scrollIntoView({ block: "center" });
  };
  document.getElementById("finish-overlay").classList.add("open");
}

function closeFinish() {
  document.getElementById("finish-overlay").classList.remove("open");
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
// Incline Bench is its own lift, not Incline Press (they used to be merged).
var EXERCISE_ALIASES = { "bench": "Bench Press", "curl": "Bicep Curl", "bicep curl": "Bicep Curl",
  "biceps curl": "Bicep Curl", "squat": "Back Squat", "row": "Bent-Over Row", "pulldown": "Lat Pulldown" };

// exerciseKey lives in core.js now (lastSessionFor needs it); still exported from here for cardio.js
export { exerciseKey };

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

export function retiredExercise(id) {
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
export function migrateExerciseNames() {
  var changed = false;
  state.settings.retiredExercises = state.settings.retiredExercises || [];
  // "Dumbbell Incline Bench" used to be folded into Incline Press. Bring it
  // back; the clean-up below then files it under Incline Bench.
  var before = state.settings.retiredExercises.length;
  state.settings.retiredExercises = state.settings.retiredExercises.filter(function (id) {
    var ex = state.exercises.filter(function (e) { return e.id === id; })[0];
    return !(ex && /\bincline\s+bench\b/i.test(ex.name));
  });
  if (state.settings.retiredExercises.length !== before) changed = true;
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

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls these in a fixed order. */

export function startLog1() {
  document.getElementById("photo-input").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !photoTarget) return;
    var t = photoTarget;
    shrinkPhoto(file)
      .then(function (data) { t.set(data); wirePhotoField(t.elId, t.get, t.set); })
      .catch(function (err) { showToast(err.message); });
  });
}

export function startLog2() {
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
        setSelectedExerciseId(null);
        persist();
        closeEditWorkout();
        renderHome();
        showToast("Workout deleted.");
      }
    });
  });
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
  document.getElementById("reuse-btn").addEventListener("click", openReusePicker);
  document.querySelectorAll("#log-kind [data-kind]").forEach(function (b) {
    b.addEventListener("click", function () { setLogKind(b.getAttribute("data-kind")); });
  });
}

export function startLog3() {
  /* Cancel leaves the log screen. With nothing typed it just goes back;
     with a workout in progress it asks first, so a stray tap loses nothing. */
  document.getElementById("finish-close").addEventListener("click", closeFinish);
  document.getElementById("finish-overlay").addEventListener("click", function (e) {
    if (e.target.id === "finish-overlay") closeFinish();
  });
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
  document.getElementById("exercise-search").addEventListener("input", function (e) {
    renderExercisePickerList(e.target.value);
  });
  document.getElementById("exercise-modal-close").addEventListener("click", closeExercisePicker);
  document.getElementById("exercise-modal-overlay").addEventListener("click", function (e) {
    if (e.target.id === "exercise-modal-overlay") closeExercisePicker();
  });
}

export function startLog4() {
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
}
