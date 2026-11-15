/**
 * Profile: your card, stats, gyms and history, and renaming.
 */

import { currentUser, photoSrc, setUsername, USERNAME_RULE } from "./store.js";
import {
  avatarHtml, closeListSheet, computeStreak, currentTab, esc, exerciseChipsHtml, findGym,
  formatTime, gymLabel, gymsOf, monthKey, monthLabel, MONTHS, myWorkouts, openListSheet,
  persist, sessionFacts, shortDate, showToast, signedOut, state, titleCase, workoutMatches
} from "./core.js";
import { openWorkoutDetail, reactionSummaryHtml, shareProfile } from "./feed.js";
import { renderGyms } from "./gyms.js";
import { renderHome } from "./home.js";
import { renderSettings, updateMe } from "./settings.js";

/* ----------------------------- profile ----------------------------- */

/* Everything that is "you over time": who you are, the all-time numbers,
   your gyms and your whole history. Home stays about today. */
/* Your profile is your account: signed out, there is nothing to show
   yet but the way in. */
var PERSON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>';

export function renderProfile() {
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
export function openRename() {
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
export function openUsername() {
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

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls this in a fixed order. */

export function startProfile() {
  document.getElementById("profile-search").addEventListener("input", function () {
    // only the list, so the search box keeps focus while you type
    renderProfileWorkouts(myWorkouts(), true);
  });
}
