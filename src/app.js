/**
 * Starts the app.
 *
 * Each screen lives in its own file (feed.js, log.js, gyms.js, ...). Those
 * files only define things when they load; nothing runs until this file
 * calls their start functions, one after another, in the order the app has
 * always started in. Then it draws the first screen and turns on sync.
 */

import { currentUser, startSync } from "./store.js";
import { startNews } from "./news.js";
import { setMapConfig } from "./geo.js";
import {
  activateTab, applyTheme, currentTab, openFromUrl, pendingInbox, pendingWorkout, persist,
  setPendingInbox, setPendingWorkout, showToast, startCore1, startCore2, startCore3,
  startCore4, state
} from "./core.js";
import { migrateCardio, startCardio } from "./cardio.js";
import { openWorkoutDetail, processPendingAdd, renderFriends, setAuthResolved, startFeed } from "./feed.js";
import { startGestures } from "./gestures.js";
import { startTour } from "./tour.js";
import { startGyms } from "./gyms.js";
import { renderHome, startHome } from "./home.js";
import { openInbox, renderBell, startInbox } from "./inbox.js";
import {
  draft, editingId, migrateExerciseNames, renderLog, restoreDraft, startLog1, startLog2,
  startLog3, startLog4
} from "./log.js";
import { startProfile } from "./profile.js";
import { startProgress } from "./progress.js";
import {
  renderSettings, startSettings1, startSettings2, startSettings3, syncLine
} from "./settings.js";

startCore1();
startSettings1();
startLog1();
startSettings2();
startHome();
startCore2();
startFeed();
startInbox();
startSettings3();
startCore3();
startLog2();
startCardio();
startLog3();
startGyms();
startProfile();
startProgress();
startLog4();
startCore4();
startGestures();

/* ----------------------------- boot ----------------------------- */

applyTheme();

setMapConfig(state.mapConfig);

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

startNews();          // a one-time message (the new app icon); see news.js
startTour();          // the first-time walkthrough, once per phone; see tour.js

/* Accounts + sync. After a pull brings in changes from another phone,
   redraw whatever is on screen -- except mid-edit, where it would wipe
   what you're typing. */
var wasAuthed = false;

/* The launch screen goes as soon as the app knows whether you're signed in
   (from this phone's saved session: no network needed). A signed-in phone
   with nothing saved yet -- a new phone -- keeps it until the first sync
   lands, so you don't see an empty app fill in. Never longer than 4s. */
var splashDone = false;
function hideSplash() {
  if (splashDone) return;
  splashDone = true;
  var el = document.getElementById("splash");
  if (!el) return;
  el.classList.add("is-done");
  setTimeout(function () { el.remove(); }, 400);
}
setTimeout(hideSplash, 4000);
var emptyPhone = true;
try { emptyPhone = !localStorage.getItem("gymsocial_sync_v1"); } catch (e) { /* storage blocked */ }

if (/[?&](workout|friends|inbox|recap|add)=/.test(location.search)) setTimeout(function () { openFromUrl(location.href); }, 0);

startSync({
  getState: function () { return state; },
  onAuth: function (signedIn) {
    if (!signedIn || !emptyPhone) hideSplash();
  },
  onChange: function () {
    if (migrateExerciseNames() | migrateCardio()) persist();   // a pull can bring an old name back
    if (pendingWorkout && state.workouts.some(function (w) { return w.id === pendingWorkout; })) {
      var wid = pendingWorkout;
      setPendingWorkout(null);
      setTimeout(function () { openWorkoutDetail(wid); }, 0);
    }
    applyTheme();
    renderBell();
    if (editingId || currentTab === "log") return;
    activateTab(currentTab);
  },
  onStatus: function (s) {
    if (s && s.status !== "syncing") hideSplash();
    // the Friends tab may be showing shapes while it waited: draw it for real
    if (s && s.status !== "syncing" && currentTab === "friends" && !editingId) renderFriends();
    setAuthResolved(true);
    processPendingAdd();
    if (pendingInbox) { setPendingInbox(false); openInbox(); }
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
