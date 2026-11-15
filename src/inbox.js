/**
 * The Inbox: friend requests, and what happened to you (reactions, comments,
 * tags, new friendships).
 */

import { acceptFriendRequest, currentUser, declineFriendRequest, refreshSocial } from "./store.js";
import {
  avatarHtml, closeListSheet, esc, findPerson, findUser, openListSheet, persist, shortDate,
  showToast, signedOut, state, workoutById
} from "./core.js";
import { actBtn, knownPeople, oneEmoji, openWorkoutDetail, renderFriends } from "./feed.js";
import { renderHome } from "./home.js";
import { addTaggedToLog, settleTag } from "./log.js";

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
    // reactions, comments and tags point at a workout: skip any whose
    // workout has since been deleted
    if (!it.workoutId) return true;
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

export function renderBell() {
  var badge = document.getElementById("inbox-badge");
  if (!badge) return;
  var n = inboxUnread();
  badge.hidden = !n;
  badge.textContent = n > 9 ? "9+" : String(n);
  document.getElementById("open-inbox").setAttribute("aria-label", n ? "Inbox, " + n + " new" : "Inbox");
}

/* "now", "5m", "2h", "3d", then a date. */
export function agoShort(iso) {
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
    var text, target, extra = "";
    if (it.kind === "reaction") {
      var wk = state.workouts.filter(function (w) { return w.id === it.workoutId; })[0];
      text = name + ' <span class="inbox-emoji">' + esc(oneEmoji(it.emoji) || "❤️") + '</span> your ' +
        '<strong>' + esc(wk.title || "workout") + '</strong>';
      target = ' data-inbox-wk="' + esc(it.workoutId) + '"';
    } else if (it.kind === "comment") {
      var cwk = workoutById(it.workoutId);
      text = name + ' commented on your <strong>' + esc(cwk.title || "workout") + '</strong>' +
        '<span class="inbox-quote">“' + esc(it.text || "") + '”</span>';
      target = ' data-inbox-wk="' + esc(it.workoutId) + '"';
    } else if (it.kind === "tag") {
      var twk = workoutById(it.workoutId);
      text = name + ' tagged you in <strong>' + esc(twk.title || "a workout") + '</strong>';
      target = ' data-inbox-wk="' + esc(it.workoutId) + '"';
      // one tap puts it in your own log; either answer settles it
      if (!(state.settings.tagsDone || {})[it.workoutId]) {
        extra = '<div class="inbox-acts">' +
          '<button class="manage-act is-primary" data-tag-add="' + esc(it.workoutId) + '">Add to my log</button>' +
          '<button class="manage-act" data-tag-skip="' + esc(it.workoutId) + '">Dismiss</button>' +
        '</div>';
      }
    } else {
      text = it.kind === "accepted" ? name + ' accepted your request' : 'You and ' + name + ' are friends';
      target = ' data-profile="' + esc(u.id) + '"';
    }
    return '<button class="inbox-row' + (it.at && it.at > seen ? " is-new" : "") + (extra ? " has-acts" : "") + '"' + target + '>' +
      '<span class="profile-tap" data-profile="' + esc(u.id) + '">' + avatarHtml(u) + '</span>' +
      '<span class="inbox-text">' + text + '</span>' +
      '<span class="inbox-when">' + esc(agoShort(it.at)) + '</span>' +
    '</button>' + extra;
  }).join("") : '<div class="empty-state">' + (requests.length
    ? "Nothing else yet."
    : "Nothing yet. Friend requests, reactions, comments and tags show up here.") + '</div>';
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
  el.querySelectorAll("[data-tag-add], [data-tag-skip]").forEach(function (b) {
    b.addEventListener("click", function () {
      var add = b.hasAttribute("data-tag-add");
      var id = b.getAttribute(add ? "data-tag-add" : "data-tag-skip");
      settleTag(id);
      if (add) addTaggedToLog(id);
      else if (inboxIsOpen()) drawInbox(el, seen);
    });
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

export function openInbox() {
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

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls this in a fixed order. */

export function startInbox() {
  document.getElementById("open-inbox").addEventListener("click", openInbox);
}
