/**
 * One-time announcements.
 *
 * Right now there is one: the app has a new icon, and a phone keeps showing
 * the old one on its Home Screen until the app is added again. The message
 * shows the new icon and the steps, once per phone. After it has been
 * dismissed (Got it, Close, or a tap outside) it never comes back.
 *
 * Someone opening the app for the very first time never sees it: they have
 * no old icon to replace.
 */
import { closeListSheet, esc, openListSheet } from "./core.js";
import { currentUser } from "./store.js";

var SEEN_KEY = "gymsocial_news_logo_v1";

/* Was anything saved on this phone before this visit? Read as the file
   loads, before the app saves its starting data for a first-time visitor
   (which comes with sample workouts, so "has workouts" can't tell). */
var hadSavedData = false;
try { hadSavedData = localStorage.getItem("gymsocial_v1") !== null; } catch (e) { /* storage blocked */ }

function seen() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch (e) { return true; }   // can't remember: don't nag
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) { /* storage blocked */ }
}

/* Has this phone used the app before today? Saved data on it, or an account. */
function usedBefore() {
  if (hadSavedData) return true;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k === "gymsocial_sync_v1" || /^sb-.*-auth-token$/.test(k)) return true;
    }
  } catch (e) { /* storage blocked */ }
  return false;
}

function onIPhone() {
  var ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function logoNewsHtml() {
  var address = (location.host + location.pathname).replace(/\/$/, "");
  var signedIn = Boolean(currentUser());
  var ios = onIPhone();
  var steps = ios
    ? [
        "Press and hold the GymSocial icon, then <b>Remove App</b> and <b>Delete from Home Screen</b>.",
        "Open <b>" + esc(address) + "</b> in Safari.",
        "Tap the Share button, then <b>Add to Home Screen</b>.",
        "Open it and sign in."
      ]
    : [
        "Remove GymSocial from your home screen.",
        "Open <b>" + esc(address) + "</b> in your browser.",
        "In the browser menu, choose <b>Add to Home screen</b> (or <b>Install app</b>).",
        "Open it and sign in."
      ];
  return '<div class="news">' +
    '<img class="news-icon" src="icon-192.png" alt="The new GymSocial icon: a dumbbell in a chat bubble" width="88" height="88">' +
    '<p class="news-lead">GymSocial has a new icon. Your home screen keeps the old one until you add the app again:</p>' +
    '<ol class="news-steps">' + steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol>" +
    (signedIn
      ? '<p class="news-note">You’re signed in, so your workouts are saved to your account and come back when you sign in.</p>'
      : '<p class="news-note is-warning"><b>You’re not signed in.</b> Removing the app erases the workouts on this phone. ' +
        'Create an account first (Settings), then do the steps above.</p>') +
    '<p class="news-note">Nothing else changes, and you can skip this: the app works the same with the old icon.</p>' +
    '<button type="button" class="btn btn-primary btn-block" id="news-ok">Got it</button>' +
    "</div>";
}

function showLogoNews() {
  var overlay = document.getElementById("list-modal-overlay");
  var body = openListSheet("New app icon", logoNewsHtml());
  // Any way of closing it counts as dismissed. If something else takes over
  // the sheet first (a notification opening the Inbox), it will show next time.
  var onClick = function () {
    setTimeout(function () {
      if (overlay.classList.contains("open")) return;
      overlay.removeEventListener("click", onClick);
      if (!document.getElementById("news-ok")) return;
      markSeen();
    }, 0);
  };
  overlay.addEventListener("click", onClick);
  body.querySelector("#news-ok").addEventListener("click", function () {
    markSeen();
    overlay.removeEventListener("click", onClick);
    closeListSheet();
  });
}

export function startNews() {
  if (seen()) return;
  if (!usedBefore()) { markSeen(); return; }
  // opened from a notification or a shared link: that comes first today
  if (/[?&](workout|friends|inbox|recap|add)=/.test(location.search)) return;
  setTimeout(function () {
    if (seen() || document.querySelector(".modal-overlay.open")) return;
    showLogoNews();
  }, 700);
}
