/**
 * Home: the calendar, the selected day, and the weekly recap.
 */

import { currentUser, refreshSocial } from "./store.js";
import {
  activateTab, avatarHtml, calendarDate, closeListSheet, computeStreak, dateInputValue,
  durationOf, esc, findGym, FLAME_SVG, formatDurationLong, formatTime, friendsOf, gymLabel,
  gymsOf, localDayKey, loggedSetTime, MONTHS, MONTHS_LONG, myWorkouts, openConfirm,
  openListSheet, persist, prsAt, renderGoalBar, sessionFacts, sessionVolume, showToast,
  signedOut, state, streakUnit, weekStartOf, workoutsOf, workoutTitleHtml
} from "./core.js";
import { CARDIO_MARK_SVG, isCardioWorkout } from "./cardio.js";
import {
  openWorkoutDetail, reactionBarHtml, receivedReactionsHtml, renderFriends, wireReactions
} from "./feed.js";
import { CROWN_SVG } from "./gyms.js";
import { renderHomeLive } from "./live.js";
import { draft, draftHasContent, resetDraft, saveDraft } from "./log.js";

/* ----------------------------- calendar ----------------------------- */

var calendarMonth = null; // first day of the displayed month
export function setCalendarMonth(v) { calendarMonth = v; return v; }
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

/* ----------------------------- home ----------------------------- */

export function renderHome() {
  var me = state.me;
  var mine = myWorkouts();
  var first = me.name.split(" ")[0];

  document.getElementById("home-greeting").textContent =
    me.name && me.name !== "You" ? first + "'s Training" : "Your Training";

  var streak = computeStreak(me.id);
  document.getElementById("profile-stats").innerHTML = [
    { label: "Workouts", value: mine.length, action: "progress" },
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
  renderHomeLive();
  renderHomeRecap();
  if (currentUser()) refreshSocial(false);      // throttled; keeps "at the gym now" fresh

  document.querySelectorAll("#profile-stats [data-stat]").forEach(function (tile) {
    tile.addEventListener("click", function () { activateTab(tile.getAttribute("data-stat")); });
  });

  renderCalendar(me.id, true);
  renderHomeDay();
}

/* The selected day, under the calendar: did you train, and who else did.
   Every entry is a full-width row; tapping one opens that session. If you
   logged nothing that day, your row is the way to log it, already dated. */
/* A workout is already half-typed: offer to carry on with it, or start
   fresh -- and only ask about discarding once they pick fresh. */
export function openDraftChoice(dayName, startNew) {
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

export function renderHomeDay() {
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

/* ----------------------------- weekly recap ----------------------------- */

/* A look back at the last full week (Sunday to Saturday, the same weeks
   the streak and the calendar use). A card for it sits on Home on Sunday
   and Monday until it's opened or dismissed; it's always under Profile. */
function recapRange() {
  var end = weekStartOf(new Date());              // this week's Sunday, 12:00 AM
  var start = new Date(end);
  start.setDate(start.getDate() - 7);
  var last = new Date(end);
  last.setDate(last.getDate() - 1);               // the Saturday
  var label = MONTHS[start.getMonth()] + " " + start.getDate() + " – " +
    (last.getMonth() === start.getMonth() ? "" : MONTHS[last.getMonth()] + " ") + last.getDate();
  return { start: start, end: end, label: label,
           key: start.getFullYear() + "-" + (start.getMonth() + 1) + "-" + start.getDate() };
}

function buildRecap() {
  var range = recapRange();
  var inWeek = function (w) {
    var t = new Date(w.performedAt).getTime();
    return t >= range.start.getTime() && t < range.end.getTime();
  };
  var mine = myWorkouts().filter(inWeek);
  var vol = { lb: 0, kg: 0 }, secs = 0, prs = [], gymCount = {};
  mine.forEach(function (w) {
    var v = sessionVolume(w.exercises);
    vol.lb += v.lb;
    vol.kg += v.kg;
    secs += durationOf(w) || loggedSetTime(w.exercises) || 0;
    prsAt(w).forEach(function (p) { prs.push(p); });
    if (w.gymId) gymCount[w.gymId] = (gymCount[w.gymId] || 0) + 1;
  });
  var topGymId = Object.keys(gymCount).sort(function (a, b) { return gymCount[b] - gymCount[a]; })[0];
  var topGym = topGymId ? findGym(topGymId) : null;
  var friends = friendsOf(state.me.id).map(function (u) {
    return { user: u, n: workoutsOf(u.id).filter(inWeek).length };
  }).filter(function (f) { return f.n > 0; })
    .sort(function (a, b) { return (b.n - a.n) || String(a.user.name).localeCompare(String(b.user.name)); });
  return {
    range: range, workouts: mine.length, vol: vol, secs: secs, prs: prs,
    topGym: topGym ? { gym: topGym, n: gymCount[topGymId] } : null,
    streak: computeStreak(state.me.id), friends: friends
  };
}

function recapVolumeText(vol) {
  if (vol.lb) return Math.round(vol.lb).toLocaleString() + " lb";
  if (vol.kg) return Math.round(vol.kg).toLocaleString() + " kg";
  return "";
}

function renderHomeRecap() {
  var el = document.getElementById("home-recap");
  if (!el) return;
  var day = new Date().getDay();
  var r = (day === 0 || day === 1) ? buildRecap() : null;
  if (!r || state.settings.recapSeen === r.range.key || (!r.workouts && !r.friends.length)) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  var line = r.workouts
    ? [r.workouts + (r.workouts === 1 ? " workout" : " workouts"), recapVolumeText(r.vol),
       r.prs.length ? r.prs.length + (r.prs.length === 1 ? " record" : " records") : ""].filter(Boolean).join(" · ")
    : "See how your friends’ week went";
  el.hidden = false;
  el.innerHTML = '<div class="recap-card">' +
    '<button class="recap-open" id="recap-open">' +
      '<span class="recap-kicker">Your week · ' + esc(r.range.label) + '</span>' +
      '<span class="recap-line">' + esc(line) + '</span>' +
    '</button>' +
    '<button class="recap-x" id="recap-x" aria-label="Dismiss this week’s recap">&times;</button>' +
  '</div>';
  el.querySelector("#recap-open").addEventListener("click", function () { openRecap(); });
  el.querySelector("#recap-x").addEventListener("click", function () {
    state.settings.recapSeen = r.range.key;
    persist();
    renderHomeRecap();
  });
}

export function openRecap() {
  var r = buildRecap();
  var unit = r.streak.mode === "daily" ? "day" : r.streak.mode === "weekly" ? "week" : "block";
  var html = '<p class="recap-when">' + esc(r.range.label) + '</p>';

  if (r.workouts) {
    var tiles = [[r.workouts, r.workouts === 1 ? "Workout" : "Workouts"]];
    if (recapVolumeText(r.vol)) tiles.push([recapVolumeText(r.vol).split(" ")[0], "Volume " + recapVolumeText(r.vol).split(" ")[1]]);
    if (r.secs) tiles.push([formatDurationLong(r.secs), "Training time"]);
    tiles.push([r.prs.length, r.prs.length === 1 ? "Record" : "Records"]);
    html += '<div class="stat-grid recap-grid">' + tiles.slice(0, 4).map(function (t) {
      return '<div class="stat-tile"><span class="num">' + esc(String(t[0])) + '</span><span class="label">' + esc(t[1]) + '</span></div>';
    }).join("") + '</div>';
    if (r.prs.length) {
      html += '<div class="pr-banner">' + FLAME_SVG.replace("streak-flame", "pr-flame") +
        '<div><div class="pr-banner-title">' + (r.prs.length === 1 ? "A new personal record" : r.prs.length + " new personal records") + '</div>' +
        r.prs.slice(0, 5).map(function (p) {
          return '<div class="pr-line">' + esc(p.name) + ' <span class="num">' + esc(p.display) + '</span></div>';
        }).join("") + '</div></div>';
    }
    var facts = [];
    if (r.streak.current > 0) facts.push('<strong>' + r.streak.current + ' ' + unit + (r.streak.current === 1 ? "" : "s") + '</strong> in a row');
    if (r.topGym) facts.push('Most at <strong>' + esc(r.topGym.gym.name) + '</strong> (' + r.topGym.n + (r.topGym.n === 1 ? " visit" : " visits") + ')');
    if (facts.length) html += '<p class="recap-facts">' + facts.join(' <span class="dot">&middot;</span> ') + '</p>';
  } else {
    html += '<div class="empty-state">No workouts last week. This one is a clean slate.</div>';
  }

  if (r.friends.length) {
    html += '<div class="manage-head">Friends last week</div>' + r.friends.slice(0, 6).map(function (f, i) {
      return '<div class="regular" data-profile="' + esc(f.user.id) + '">' +
        '<span class="regular-rank">' + (i === 0 ? CROWN_SVG : i + 1) + '</span>' + avatarHtml(f.user) +
        '<span class="regular-name">' + esc(f.user.name) + '</span>' +
        '<span class="regular-n num">' + f.n + (f.n === 1 ? " workout" : " workouts") + '</span></div>';
    }).join("");
  }
  html += '<button class="btn btn-primary btn-block" id="recap-done" style="margin-top:18px;">Done</button>';

  var el = openListSheet("Your week", html);
  el.querySelector("#recap-done").addEventListener("click", closeListSheet);
  // opening it is seeing it: the Home card for this week steps aside
  if (state.settings.recapSeen !== r.range.key) {
    state.settings.recapSeen = r.range.key;
    persist();
    renderHomeRecap();
  }
}

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls this in a fixed order. */

export function startHome() {
  document.getElementById("cal-prev").addEventListener("click", function () {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderHome();
  });
  document.getElementById("cal-next").addEventListener("click", function () {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderHome();
  });
}
