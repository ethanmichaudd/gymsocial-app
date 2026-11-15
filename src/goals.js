/**
 * Goals: your weekly workout target, and strength goals measured by
 * estimated one-rep max (1RM). They live at the top of the Progress screen.
 *
 * Goals are kept in settings, so they sync with the account like every
 * other preference and need no database change.
 */

import {
  activateTab, closeListSheet, computeStreak, defaultUnit, esc, findExercise, metricOf, myWorkouts,
  openListSheet, persist, shortDate, showToast, state
} from "./core.js";

var KG_PER_LB = 0.45359237;
var MAX_GOALS = 5;            // a handful to chase, not a spreadsheet

function convert(weight, from, to) {
  if (from === to) return weight;
  return to === "kg" ? weight * KG_PER_LB : weight / KG_PER_LB;
}

/* "245 lb", "112.5 kg": whole pounds, half kilos -- the steps plates come in. */
export function weightText(value, unit) {
  var v = unit === "kg" ? Math.round(value * 2) / 2 : Math.round(value);
  return v + " " + unit;
}

/**
 * Estimated 1RM: the most you could likely lift once, worked out from a set
 * of several reps (the Epley formula: weight x (1 + reps / 30)). A single is
 * simply the weight. Past 12 reps the estimate stops being trustworthy, so
 * those sets don't count.
 */
export function estimate1RM(weight, reps) {
  if (!(weight > 0) || !(reps >= 1) || reps > 12) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/**
 * Your best estimate for every lift you've logged with weight, in `unit`:
 *   { exerciseId: { exerciseId, name, value, weight, reps, setUnit, date, sessions } }
 */
export function best1RMs(unit) {
  var out = {};
  myWorkouts().forEach(function (wk) {
    wk.exercises.forEach(function (blk) {
      if (metricOf(blk) !== "reps") return;
      var ex = findExercise(blk.exerciseId);
      if (!ex) return;
      var e = out[blk.exerciseId] = out[blk.exerciseId] ||
        { exerciseId: blk.exerciseId, name: ex.name, value: 0, sessions: 0 };
      var counted = false;
      blk.sets.forEach(function (s) {
        var est = estimate1RM(s.weight, s.reps);
        if (est == null) return;
        counted = true;
        var setUnit = s.unit === "kg" ? "kg" : "lb";
        var v = convert(est, setUnit, unit);
        if (v > e.value) {
          e.value = v; e.weight = s.weight; e.reps = s.reps; e.setUnit = setUnit; e.date = wk.performedAt;
        }
      });
      if (counted) e.sessions++;
    });
  });
  Object.keys(out).forEach(function (id) { if (!out[id].value) delete out[id]; });
  return out;
}

function goals() {
  if (!Array.isArray(state.settings.goals)) state.settings.goals = [];
  return state.settings.goals;
}

/* A goal points at an exercise by id. Ids can change when a phone first
   syncs, so the name is kept too and used to find the lift again. */
function bestFor(goal, bests) {
  if (bests[goal.exerciseId]) return bests[goal.exerciseId];
  var want = String(goal.name || "").trim().toLowerCase();
  var id = Object.keys(bests).filter(function (k) {
    return String(bests[k].name).trim().toLowerCase() === want;
  })[0];
  if (id) goal.exerciseId = id;
  return id ? bests[id] : null;
}

/* Where a goal stands: { now, pct (0..1), reached, togo, best }. */
function standing(goal) {
  var best = bestFor(goal, best1RMs(goal.unit));
  var now = best ? best.value : 0;
  var span = goal.target - goal.start;
  var reached = now + 0.01 >= goal.target;
  return {
    best: best, now: now, reached: reached,
    pct: reached ? 1 : span > 0 ? Math.max(0, Math.min(1, (now - goal.start) / span)) : 0,
    togo: Math.max(0, goal.target - now)
  };
}

/**
 * Goals this workout just reached, for the "Nice work" sheet. Each goal is
 * only ever announced once.
 */
export function goalsReachedBy(workout) {
  var hit = [];
  goals().forEach(function (g) {
    if (g.reachedAt) return;
    var s = standing(g);
    if (!s.reached) return;
    g.reachedAt = s.best && s.best.date ? s.best.date : new Date().toISOString();
    if (workout && s.best && s.best.date === workout.performedAt) hit.push({ name: g.name, text: weightText(g.target, g.unit) });
  });
  if (hit.length) persist();
  return hit;
}

/* ----------------------------- the Goals card ----------------------------- */

function barHtml(pct, done, label) {
  return '<div class="goal-bar' + (done ? " is-done" : "") + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" ' +
    'aria-valuenow="' + Math.round(pct * 100) + '" aria-label="' + esc(label) + '"><span style="width:' +
    Math.round(pct * 100) + '%"></span></div>';
}

/* The workout target you already set in Settings, shown as a goal. */
function weeklyRowHtml() {
  var st = computeStreak(state.me.id);
  var title, value, pct;
  if (st.mode === "daily") {
    title = "Today";
    value = st.inPeriod ? "Logged" : "Not yet";
    pct = st.inPeriod ? 1 : 0;
  } else {
    title = st.mode === "weekly" ? "This week" : "Last " + st.days + " days";
    value = st.inPeriod + " of " + st.goal + (st.goal === 1 ? " workout" : " workouts");
    pct = st.goal ? Math.min(1, st.inPeriod / st.goal) : 0;
  }
  return '<div class="goal-row is-weekly">' +
    '<div class="goal-top"><span class="goal-name">' + title + '</span>' +
      '<span class="goal-value num">' + esc(value) + '</span></div>' +
    barHtml(pct, pct >= 1, title + ": " + value) +
    '<div class="goal-sub">' +
      (st.current > 0 ? st.current + " in a row" : "Your workout target") +
      ' <button class="text-link" id="goal-weekly-change">Change</button></div>' +
  '</div>';
}

export function renderGoals() {
  var el = document.getElementById("goals-card");
  if (!el) return;
  var list = goals();
  var html = '<div class="goals-head">Goals</div>' + weeklyRowHtml();

  html += list.map(function (g) {
    var s = standing(g);
    var sub = s.reached
      ? "Reached" + (g.reachedAt || (s.best && s.best.date) ? " " + shortDate(g.reachedAt || s.best.date) : "")
      : weightText(s.togo, g.unit) + " to go" +
        (s.best ? " · best set " + s.best.weight + " " + s.best.setUnit + " × " + s.best.reps : " · nothing logged yet");
    return '<button class="goal-row' + (s.reached ? " is-reached" : "") + '" data-goal="' + esc(g.id) + '">' +
      '<span class="goal-top"><span class="goal-name">' + esc(g.name) + '</span>' +
        '<span class="goal-value num">' + esc(weightText(s.now, g.unit).split(" ")[0]) +
          ' <span class="goal-arrow">→</span> ' + esc(weightText(g.target, g.unit)) + '</span></span>' +
      barHtml(s.pct, s.reached, g.name + ": estimated one-rep max " + weightText(s.now, g.unit) + " of " + weightText(g.target, g.unit)) +
      '<span class="goal-sub">' + esc(sub) + '</span>' +
    '</button>';
  }).join("");

  if (!list.length) {
    html += '<p class="goal-hint">Pick a lift and a number to chase. Progress is tracked by your <strong>estimated 1RM</strong>: ' +
      'the most you could likely lift once, worked out from your best set.</p>';
  }
  if (list.length < MAX_GOALS) {
    html += '<button class="btn btn-ghost btn-block" id="goal-add">+ Add a strength goal</button>';
  }
  el.innerHTML = html;

  el.querySelector("#goal-weekly-change").addEventListener("click", function () { activateTab("settings"); });
  var add = el.querySelector("#goal-add");
  if (add) add.addEventListener("click", function () { openGoalSheet(null); });
  el.querySelectorAll("[data-goal]").forEach(function (row) {
    row.addEventListener("click", function () {
      var id = row.getAttribute("data-goal");
      openGoalSheet(goals().filter(function (g) { return g.id === id; })[0] || null);
    });
  });
}

/* A sensible first target: a bit above where you are, on a round number. */
function suggestTarget(now, unit) {
  var step = unit === "kg" ? 2.5 : 5;
  return Math.ceil((now * 1.05 + 0.01) / step) * step;
}

/* One sheet for both jobs: with a goal it edits that one, without it adds one. */
function openGoalSheet(goal) {
  var unit = goal ? goal.unit : defaultUnit();
  var bests = best1RMs(unit);
  var taken = {};
  goals().forEach(function (g) { if (g !== goal) taken[g.exerciseId] = true; });
  var choices = Object.keys(bests).map(function (id) { return bests[id]; })
    .filter(function (b) { return !taken[b.exerciseId]; })
    .sort(function (a, b) { return (b.sessions - a.sessions) || a.name.localeCompare(b.name); });

  if (!goal && !choices.length) {
    openListSheet("Strength goal", '<div class="empty-state">Log a lift with weight first (12 reps or fewer). ' +
      'Then you can set a goal for it here.</div>');
    return;
  }

  var el = openListSheet(goal ? "Edit goal" : "Strength goal",
    '<div class="field">' +
      '<label class="field-label" for="goal-ex">Lift</label>' +
      (goal
        ? '<div class="goal-fixed">' + esc(goal.name) + '</div>'
        : '<select id="goal-ex">' + choices.map(function (b) {
            return '<option value="' + esc(b.exerciseId) + '">' + esc(b.name) + '</option>';
          }).join("") + '</select>') +
      '<p class="setting-help" id="goal-now"></p>' +
    '</div>' +
    '<div class="field">' +
      '<label class="field-label" for="goal-target">Goal: estimated 1RM (' + unit + ')</label>' +
      '<input type="number" inputmode="decimal" id="goal-target" min="1" step="' + (unit === "kg" ? "0.5" : "1") + '">' +
    '</div>' +
    '<button class="btn btn-primary btn-block" id="goal-save">' + (goal ? "Save goal" : "Set goal") + '</button>' +
    (goal ? '<button class="btn-danger-text btn-block" id="goal-remove" style="margin-top:12px;">Remove this goal</button>' : ''));

  var target = el.querySelector("#goal-target");
  var current = function () {
    if (goal) return bestFor(goal, bests);
    return bests[el.querySelector("#goal-ex").value] || null;
  };
  var describe = function (fill) {
    var b = current();
    el.querySelector("#goal-now").textContent = b
      ? "Estimated 1RM now: " + weightText(b.value, unit) + " (best set " + b.weight + " " + b.setUnit +
        " × " + b.reps + ", " + shortDate(b.date) + ")"
      : "Nothing logged for this lift yet.";
    if (fill) target.value = b ? suggestTarget(b.value, unit) : "";
  };
  describe(!goal);
  if (goal) target.value = goal.target;
  var pick = el.querySelector("#goal-ex");
  if (pick) pick.addEventListener("change", function () { describe(true); });

  el.querySelector("#goal-save").addEventListener("click", function () {
    var b = current();
    var want = Number(target.value);
    var now = b ? b.value : 0;
    if (!(want > 0)) { showToast("Enter the weight you’re aiming for."); return; }
    if (want <= now + 0.01) {
      showToast("You’re already at " + weightText(now, unit) + ". Aim higher than that.");
      return;
    }
    if (goal) {
      if (want !== goal.target) { goal.target = want; delete goal.reachedAt; }
    } else {
      goals().push({
        id: "g" + Date.now().toString(36), exerciseId: b.exerciseId, name: b.name,
        target: want, unit: unit, start: now, createdAt: new Date().toISOString()
      });
    }
    persist();
    closeListSheet();
    renderGoals();
    showToast(goal ? "Goal updated." : "Goal set: " + (goal ? goal.name : b.name) + " " + weightText(want, unit) + ".");
  });

  var remove = el.querySelector("#goal-remove");
  if (remove) remove.addEventListener("click", function () {
    state.settings.goals = goals().filter(function (g) { return g !== goal; });
    persist();
    closeListSheet();
    renderGoals();
    showToast("Goal removed.");
  });
}
