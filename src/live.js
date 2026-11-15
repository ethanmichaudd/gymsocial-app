/**
 * At the gym now: the opt-in that shows friends where you're training, and
 * where it appears.
 */

import { clearPresence, currentUser, setPresence } from "./store.js";
import {
  avatarHtml, currentTab, dateInputValue, esc, featureOn, findGym, findUser, persist,
  showToast, state
} from "./core.js";
import { knownGym, openGymModal } from "./gyms.js";
import { draft } from "./log.js";
import { renderSettings } from "./settings.js";

/* ----------------------------- at the gym now ----------------------------- */

/* Opt-in, and off until you say so. With it on, checking in to a gym for
   today's workout shows friends "Maya is at Planet Fitness · 25m". It ends
   when you save or cancel the workout, pick a different day, tap Stop, or
   three hours pass -- the database enforces the three hours on its own,
   so a closed app can't leave you "at the gym" all night. */
var LIVE_MS = 3 * 3600 * 1000;
var liveQueue = Promise.resolve();    // start/stop reach the database in the order they happened

function liveAllowed() {
  return !!currentUser() && !!state.settings.shareLive && featureOn("live");
}

export function todayInput() {
  return dateInputValue(new Date().toISOString());
}

/* Where you're currently showing, or null. Forgets itself when it's stale. */
function myLive() {
  var l = state.myLive;
  if (!l) return null;
  if (Date.now() - new Date(l.at).getTime() > LIVE_MS) {
    delete state.myLive;
    return null;
  }
  // Not shown while it can't be true (e.g. the moment after opening the
  // app, before the account has loaded) -- but not forgotten either.
  return liveAllowed() ? l : null;
}

export function sinceShort(iso) {
  var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m";
}

export function startLive(gymId) {
  if (!liveAllowed() || !gymId || draft.date !== todayInput()) return;
  var cur = myLive();
  if (cur && cur.gymId === gymId) return;
  state.myLive = { gymId: gymId, at: new Date().toISOString() };
  persist();
  var undo = function () {
    if (state.myLive && state.myLive.gymId === gymId) { delete state.myLive; persist(); renderLiveBits(); }
  };
  liveQueue = liveQueue.then(function () { return setPresence(gymId); })
    .then(function (ok) { if (!ok) undo(); }, undo);
  renderLiveBits();
}

export function stopLive() {
  if (!state.myLive) return;
  delete state.myLive;
  persist();
  liveQueue = liveQueue.then(function () { return clearPresence(); }).catch(function () { /* it expires on its own */ });
  renderLiveBits();
}

function renderLiveBits() {
  renderLogLive();
  if (currentTab === "home") renderHomeLive();
}

/* Friends who are at a gym right now: [{ user, gym, at }]. */
export function liveFriends() {
  if (!currentUser()) return [];
  var now = Date.now();
  return (state.liveFriends || []).filter(function (l) {
    return l.expiresAt && new Date(l.expiresAt).getTime() > now;
  }).map(function (l) {
    return { user: findUser(l.userId), gym: findGym(l.gymId), gymId: l.gymId, at: l.startedAt };
  }).filter(function (l) { return l.user && l.gym; });
}

/* Under the gym picker on the log screen: either the way to start showing,
   or a plain statement that you are, with a way to stop. */
export function renderLogLive() {
  var el = document.getElementById("log-live");
  if (!el) return;
  var g = draft.gymId ? knownGym(draft.gymId) : null;
  var live = myLive();
  var html = "";
  if (g && live && live.gymId === draft.gymId) {
    html = '<span class="live-dot"></span>' +
      '<span class="live-text">Friends can see you’re at <strong>' + esc(g.name) + '</strong> &middot; ' +
        esc(sinceShort(live.at)) + '</span>' +
      '<button type="button" class="text-link" id="live-stop">Stop</button>';
  } else if (g && liveAllowed() && draft.date === todayInput()) {
    html = '<button type="button" class="live-start" id="live-start">' +
      '<span class="live-dot is-off"></span>I’m here now: show my friends</button>';
  }
  el.hidden = !html;
  el.innerHTML = html;
  var stop = el.querySelector("#live-stop");
  if (stop) stop.addEventListener("click", stopLive);
  var start = el.querySelector("#live-start");
  if (start) start.addEventListener("click", function () { startLive(draft.gymId); });
}

/* On Home, above the calendar: who is training right now. */
export function renderHomeLive() {
  var el = document.getElementById("home-live");
  if (!el) return;
  var html = "";
  var mine = myLive();
  var mineGym = mine ? knownGym(mine.gymId) : null;
  if (mine && mineGym) {
    html += '<div class="live-row is-me"><span class="live-dot"></span>' +
      '<span class="live-text">Friends can see you’re at <strong>' + esc(mineGym.name) + '</strong> &middot; ' +
        esc(sinceShort(mine.at)) + '</span>' +
      '<button type="button" class="text-link" id="home-live-stop">Stop</button></div>';
  }
  html += liveFriends().map(function (l) {
    return '<button class="live-row" data-live-gym="' + esc(l.gymId) + '"><span class="live-dot"></span>' +
      avatarHtml(l.user) +
      '<span class="live-text"><strong>' + esc(String(l.user.name).split(" ")[0]) + '</strong> is at <strong>' +
        esc(l.gym.name) + '</strong> &middot; ' + esc(sinceShort(l.at)) + '</span>' +
      '<span class="chevron">&rsaquo;</span></button>';
  }).join("");
  el.innerHTML = html;
  el.hidden = !html;
  var stop = el.querySelector("#home-live-stop");
  if (stop) stop.addEventListener("click", stopLive);
  el.querySelectorAll("[data-live-gym]").forEach(function (row) {
    row.addEventListener("click", function () { openGymModal(row.getAttribute("data-live-gym")); });
  });
}

export function liveBlockHtml() {
  if (!currentUser()) return "";
  return '<div class="setting-block">' +
    '<div class="switch-row">' +
      '<label class="field-label" for="live-switch" style="margin:0;">Show friends when I’m at the gym</label>' +
      '<button class="switch" id="live-switch" role="switch" aria-checked="' +
        (state.settings.shareLive ? "true" : "false") + '"><span></span></button>' +
    '</div>' +
    '<p class="setting-help">Off unless you turn it on. When you check in to a gym for today’s workout, ' +
      'friends see you there until you save or cancel it, and never for more than three hours.</p>' +
  '</div>';
}

export function wireLive(el) {
  var sw = el.querySelector("#live-switch");
  if (!sw) return;
  sw.addEventListener("click", function () {
    if (sw.getAttribute("aria-checked") === "true") {
      stopLive();
      state.settings.shareLive = false;
      persist();
      liveQueue = liveQueue.then(function () { return clearPresence(); }).catch(function () { /* it expires on its own */ });
      renderSettings();
      showToast("Off. Friends won’t see when you’re at the gym.");
      return;
    }
    sw.disabled = true;
    // clearing first does two jobs: it proves this database can do it, and
    // it starts from a clean slate
    clearPresence().then(function (ok) {
      if (!ok) {
        showToast("This needs a database update first: run supabase/009_social.sql.");
        renderSettings();
        return;
      }
      state.settings.shareLive = true;
      persist();
      renderSettings();
      showToast("On. Friends see you when you check in for today’s workout.");
    }, function () {
      showToast("Couldn’t turn that on. Check your connection.");
      renderSettings();
    });
  });
}
