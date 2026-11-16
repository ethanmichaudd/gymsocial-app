/**
 * The social side of a workout: reactions, comments, the Friends feed, other
 * people's profiles, the workout detail sheet and the share card.
 */

import {
  acceptFriendRequest, addComment, cancelFriendRequest, cloudEnabled, currentUser,
  declineFriendRequest, deleteComment, photoSrc, refreshSocial, removeFriend, searchPeople,
  sendFriendRequest, setReaction
} from "./store.js";
import {
  activateTab, avatarHtml, buzz, calendarDate, closeListSheet, durationOf, esc, featureOn,
  findExercise, findGym, findPerson, findUser, formatDuration, formatDurationLong, formatTime,
  FRIENDS_SVG, friendsOf, gymAddress, gymLabel, localDayKey, loggedSetTime, metricOf,
  openConfirm, openListSheet, persist, prsAt, repSetCount, sessionDistance, sessionFacts,
  sessionVolume, shortDate, showToast, signedOut, state, summarizeSets, workoutById,
  workoutsOf, workoutTitleHtml
} from "./core.js";
import { cardioTiles, isCardioWorkout } from "./cardio.js";
import { openGymModal } from "./gyms.js";
import { renderHome, renderHomeDay } from "./home.js";
import { agoShort } from "./inbox.js";
import { openEditWorkout, startReuse, supersetLabels } from "./log.js";
import { authNote, openAuth } from "./settings.js";

/* Four is enough to say something without turning into a keyboard. */
var REACTIONS = ["\uD83D\uDCAA", "\uD83D\uDD25", "\uD83D\uDC4F", "\uD83D\uDE4C"];

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
export function oneEmoji(raw) {
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
export function reactionBarHtml(wk) {
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
    commentChipHtml(wk, false) +
  '</div>';
}

var COMMENT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M20 12.3a7.6 7.6 0 0 1-11.2 6.7L4 20l1.1-4.5A7.6 7.6 0 1 1 20 12.3z"/></svg>';
var SEND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>';

/* The speech bubble at the end of a reaction bar: how many comments, and
   the way in to read or write one. On your own workouts (which have no
   buttons to react with) it only shows once there is something to read. */
function commentChipHtml(wk, onlyIfAny) {
  if (!featureOn("comments")) return "";
  var n = (wk.comments || []).length;
  if (onlyIfAny && !n) return "";
  return '<button class="react comment-chip" data-comments="' + esc(wk.id) + '" aria-label="' +
    (n ? n + (n === 1 ? " comment" : " comments") : "Comment") + '">' + COMMENT_SVG +
    (n ? '<span class="react-n">' + n + '</span>' : '') + '</button>';
}

/* Who a workout was done with: "with Maya, Dev". First names, "you" for
   you, and a count once the line would run long. */
function withPeople(wk) {
  return (wk.withIds || []).map(function (id) {
    if (id === state.me.id) return { id: id, name: state.me.name, avatar: state.me.avatar, isMe: true };
    return findPerson(id) || null;
  }).filter(Boolean);
}

function withText(wk) {
  var people = withPeople(wk);
  if (!people.length) return "";
  var names = people.slice(0, 3).map(function (u) { return u.isMe ? "you" : String(u.name).split(" ")[0]; });
  return "with " + names.join(", ") + (people.length > 3 ? " +" + (people.length - 3) : "");
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
export function receivedReactionsHtml(wk) {
  var all = reactionsOf(wk);
  var chips = reactionOrder(wk).filter(function (e) { return (all[e] || []).length; }).map(function (e) {
    return '<span class="react is-static">' + esc(e) + '<span class="react-n">' + all[e].length + '</span></span>';
  });
  var talk = commentChipHtml(wk, true);
  return chips.length || talk ? '<div class="react-bar">' + chips.join("") + talk + '</div>' : '';
}

/* A line on your own cards in History: who reacted, at a glance. */
export function reactionSummaryHtml(wk) {
  var all = reactionsOf(wk);
  var n = 0, shown = [];
  reactionOrder(wk).forEach(function (e) {
    if ((all[e] || []).length) { n += all[e].length; shown.push(e); }
  });
  return n ? '<span class="react-summary">' + esc(shown.slice(0, 5).join("")) + ' ' + n + '</span>' : '';
}

/* One handler for every reaction button inside a container. */
export function wireReactions(root, after) {
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

  root.querySelectorAll("[data-comments]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      openWorkoutDetail(btn.getAttribute("data-comments"), { comment: true });
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

export function renderFriends() {
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
              .concat(withText(row.wk) ? [esc(withText(row.wk))] : [])
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
export var knownPeople = {};

function openProfileById(id) {
  if (id === state.me.id) { closeListSheet(); activateTab("profile"); return; }
  var u = findUser(id) || knownPeople[id];
  if (u) openUserProfile(u);
}

function profileLink(u) {
  return location.origin + location.pathname + "?add=" + encodeURIComponent(u.handle || "");
}

/* The share sheet on a phone; a copied link anywhere else. */
export function shareProfile(u) {
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
export function setPendingAdd(v) { pendingAdd = v; return v; }
export var authResolved = false;     // has Supabase said whether we're signed in yet?
export function setAuthResolved(v) { authResolved = v; return v; }
var addPromptShown = false;

export function processPendingAdd() {
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

export function actBtn(kind, id, label, cls) {
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
    '<div class="find-box is-sticky">' +
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

/* ----------------------------- a logged session ----------------------------- */

/* What you get when you tap a session: the whole thing laid out to be read,
   or handed to someone. Editing is a button, not what tapping does. */
function detailIsOpen(workoutId) {
  var head = document.querySelector("#list-modal-body [data-detail-id]");
  return !!head && head.getAttribute("data-detail-id") === workoutId &&
    document.getElementById("list-modal-overlay").classList.contains("open");
}

/* The thread under a workout. Anyone who can see the workout can read it;
   writing takes being the owner or a friend (the database enforces the
   same rule, this just doesn't offer a box that would be refused). */
function commentsHtml(wk) {
  if (!featureOn("comments")) return "";
  var mine = wk.userId === state.me.id;
  var canWrite = mine || relationTo(wk.userId) === "friend";
  var list = wk.comments || [];
  if (!list.length && !canWrite) return "";
  return '<div class="comments">' +
    '<div class="manage-head">Comments' + (list.length ? " (" + list.length + ")" : "") + '</div>' +
    list.map(function (c) {
      var isMe = c.userId === state.me.id;
      var u = isMe ? state.me : (findPerson(c.userId) || { id: c.userId, name: "Someone" });
      return '<div class="comment' + (c.pending ? " is-pending" : "") + '">' +
        '<span class="profile-tap" data-profile="' + esc(c.userId) + '">' + avatarHtml(u) + '</span>' +
        '<div class="comment-body">' +
          '<div class="comment-meta">' +
            '<span class="comment-name">' + esc(isMe ? "You" : u.name) + '</span>' +
            '<span class="comment-when">' + esc(c.pending ? "sending…" : agoShort(c.at)) + '</span>' +
            ((isMe || mine) && !c.pending
              ? '<button class="comment-del" data-comment-del="' + esc(c.id) + '">Delete</button>' : '') +
          '</div>' +
          '<div class="comment-text">' + esc(c.body) + '</div>' +
        '</div>' +
      '</div>';
    }).join("") +
    (canWrite
      ? '<form class="comment-box" id="comment-form">' +
          '<input type="text" id="comment-input" maxlength="500" placeholder="Add a comment…" ' +
            'autocomplete="off" enterkeyhint="send" aria-label="Add a comment">' +
          '<button type="submit" class="comment-send" aria-label="Post comment">' + SEND_SVG + '</button>' +
        '</form>'
      : '') +
  '</div>';
}

function wireComments(el, workoutId) {
  var redraw = function () {
    if (detailIsOpen(workoutId)) openWorkoutDetail(workoutId);
    renderFriends();
    renderHomeDay();
  };
  var form = el.querySelector("#comment-form");
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = el.querySelector("#comment-input").value.trim();
    var wk = workoutById(workoutId);
    if (!text || !wk) return;
    // shown straight away, greyed until the database has it
    var pending = { id: "pending-" + Date.now(), userId: state.me.id, body: text,
                    at: new Date().toISOString(), pending: true };
    (wk.comments = wk.comments || []).push(pending);
    redraw();
    addComment(workoutId, text).then(function (saved) {
      // a sync may have swapped the workout object underneath us: look it up again
      var now = workoutById(workoutId);
      if (!now) return;
      now.comments = (now.comments || []).filter(function (c) { return c.id !== pending.id && c.id !== saved.id; });
      now.comments.push(saved);
      persist();
      redraw();
    }, function (err) {
      var now = workoutById(workoutId);
      if (now) now.comments = (now.comments || []).filter(function (c) { return c.id !== pending.id; });
      redraw();
      showToast((err && err.message) || "Couldn’t post that.");
      var box = document.querySelector("#list-modal-body #comment-input");
      if (box && detailIsOpen(workoutId)) box.value = text;     // don't make them type it again
    });
  });
  el.querySelectorAll("[data-comment-del]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-comment-del");
      var wk = workoutById(workoutId);
      if (!wk) return;
      var gone = (wk.comments || []).filter(function (c) { return c.id === id; })[0];
      wk.comments = (wk.comments || []).filter(function (c) { return c.id !== id; });
      redraw();
      deleteComment(id).then(function () { persist(); }, function (err) {
        var now = workoutById(workoutId);
        if (now && gone) {
          now.comments = (now.comments || []).concat([gone])
            .sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
        }
        redraw();
        showToast((err && err.message) || "Couldn’t delete that.");
      });
    });
  });
}

export function openWorkoutDetail(workoutId, opts) {
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
  var together = withPeople(wk);
  var html =
    '<div class="detail-head" data-detail-id="' + esc(workoutId) + '">' +
      (who
        ? '<div class="detail-who" data-profile="' + esc(who.id) + '">' + avatarHtml(who) +
          '<span>' + esc(who.name) + '</span><span class="chevron">&rsaquo;</span></div>'
        : '') +
      '<div class="detail-title">' + workoutTitleHtml(wk) + '</div>' +
      '<div class="detail-when">' + calendarDate(wk.performedAt) + ' &middot; ' +
        esc(formatTime(wk.performedAt)) +
        (wk.endedAt ? ' &ndash; ' + esc(formatTime(wk.endedAt)) : '') + '</div>' +
      (gymObj
        ? '<div class="detail-gym" data-gym-open="' + esc(gymObj.id) + '"><span class="detail-gym-name">' + esc(gymLabel(gymObj)) +
            '<span class="chevron">&rsaquo;</span></span>' +
          (gymAddress(gymObj) ? '<span class="detail-gym-addr">' + esc(gymAddress(gymObj)) + '</span>' : '') +
          '</div>'
        : '') +
      (together.length
        ? '<div class="detail-with"><span class="avatar-stack is-mid">' + together.slice(0, 5).map(function (u) {
            return '<span class="profile-tap" data-profile="' + esc(u.id) + '">' + avatarHtml(u) + '</span>';
          }).join("") + '</span><span>' + esc(withText(wk).replace(/^w/, "W")) + '</span></div>'
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
    html += commentsHtml(wk);
    html += '<button class="btn btn-ghost btn-block" id="detail-edit" style="margin-top:18px;">Edit workout</button>';
  } else {
    // the bar's own speech bubble would only reopen this sheet, so it's left off here
    html += '<div class="detail-react">' +
      reactionBarHtml(wk).replace(/<button class="react comment-chip"[\s\S]*?<\/button>/, "") + '</div>';
    html += commentsHtml(wk);
  }
  html += '<button class="btn btn-ghost btn-block" id="detail-reuse" style="margin-top:' + (mine ? 8 : 16) + 'px;">' +
    (mine ? "Reuse this workout" : "Do this workout") + '</button>';
  if (mine) html += '<button class="btn btn-ghost btn-block" id="detail-share" style="margin-top:8px;">Share as a picture</button>';

  var el = openListSheet("Workout", html);
  var gymLink = el.querySelector("[data-gym-open]");
  if (gymLink) gymLink.addEventListener("click", function () {
    closeListSheet();
    openGymModal(gymLink.getAttribute("data-gym-open"));
  });
  el.querySelector("#detail-reuse").addEventListener("click", function () { startReuse(wk); });
  wireComments(el, workoutId);
  var shareBtn = el.querySelector("#detail-share");
  if (shareBtn) shareBtn.addEventListener("click", function () { openShareCard(workoutId); });
  if (opts && opts.comment) {
    // came in through the speech bubble: bring the thread into view
    var thread = el.querySelector(".comments");
    if (thread && thread.scrollIntoView) thread.scrollIntoView({ block: "nearest" });
  }
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

/* ----------------------------- share card ----------------------------- */

/* A workout as a picture, sized for an Instagram Story (1080 x 1920): the
   title, where and when, the headline numbers, and either the records it
   set or what was trained. Drawn on a canvas, so it never leaves the phone
   until you share it. The card has one look in both themes -- it's going
   somewhere else, not sitting inside the app. */
var CARD_W = 1080;
var CARD_H = 1920;
var CARD_FONT = '"Inter", -apple-system, "Segoe UI", sans-serif';
var shareUrl = null;            // the picture currently on screen, so the old one can be released

function cardFont(weight, size) {
  return weight + " " + size + "px " + CARD_FONT;
}

/* Shortens text with an ellipsis until it fits. */
function fitText(ctx, text, maxWidth) {
  text = String(text);
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > maxWidth) text = text.slice(0, -1);
  return text.replace(/\s+$/, "") + "…";
}

/* Breaks text into at most maxLines lines; the last one is shortened to fit. */
function wrapText(ctx, text, maxWidth, maxLines) {
  var words = String(text).split(/\s+/).filter(Boolean);
  var lines = [];
  var line = "";
  words.forEach(function (w) {
    var next = line ? line + " " + w : w;
    if (!line || ctx.measureText(next).width <= maxWidth) line = next;
    else { lines.push(line); line = w; }
  });
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines - 1).concat([lines.slice(maxLines - 1).join(" ")]);
  }
  return lines.map(function (l) { return fitText(ctx, l, maxWidth); });
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* The headline numbers, most telling first: at most three. */
function cardTiles(wk) {
  var tiles = [];
  var secs = durationOf(wk), logged = loggedSetTime(wk.exercises);
  if (secs) tiles.push([formatDurationLong(secs), "Duration"]);
  else if (logged) tiles.push([formatDuration(logged), "Time"]);
  var dist = sessionDistance(wk.exercises);
  if (dist.mi) tiles.push([String(Math.round(dist.mi * 100) / 100), "Miles"]);
  else if (dist.km) tiles.push([String(Math.round(dist.km * 100) / 100), "Km"]);
  var vol = sessionVolume(wk.exercises);
  if (vol.lb) tiles.push([Math.round(vol.lb).toLocaleString(), "Lb lifted"]);
  else if (vol.kg) tiles.push([Math.round(vol.kg).toLocaleString(), "Kg lifted"]);
  var sets = repSetCount(wk.exercises);
  if (sets) tiles.push([String(sets), sets === 1 ? "Set" : "Sets"]);
  if (wk.calories != null) tiles.push([String(wk.calories), "Calories"]);
  if (!tiles.length) tiles.push([String(wk.exercises.length), wk.exercises.length === 1 ? "Exercise" : "Exercises"]);
  return tiles.slice(0, 3);
}

/* The workout's photo, if it has one and the browser will let a canvas
   use it. Resolves to null rather than failing: the card works without. */
function loadCardPhoto(wk) {
  var src = photoSrc(wk);
  if (!src) return Promise.resolve(null);
  return new Promise(function (resolve) {
    var img = new Image();
    var done = function (v) { clearTimeout(timer); resolve(v); };
    var timer = setTimeout(function () { done(null); }, 5000);
    if (!/^data:/.test(src)) img.crossOrigin = "anonymous";
    img.onload = function () { done(img); };
    img.onerror = function () { done(null); };
    img.src = src;
  });
}

function cardFontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  var wait = Promise.all(["800 100px Inter", "700 40px Inter", "600 40px Inter", "500 40px Inter"]
    .map(function (f) { return document.fonts.load(f); })).catch(function () { /* system font instead */ });
  // never hold the card up for a font
  return Promise.race([wait, new Promise(function (r) { setTimeout(r, 1500); })]);
}

/* Painted twice when there's no photo: once to find out how tall the
   content is, then again nudged down so a short workout sits in the
   middle of the card instead of leaving the bottom half empty. */
function paintWorkoutCard(wk, photo) {
  if (photo) return paintCard(wk, photo, 0).canvas;
  var first = paintCard(wk, null, 0);
  var spare = (CARD_H - 190) - first.endY;
  return spare > 160 ? paintCard(wk, null, Math.round(spare * 0.42)).canvas : first.canvas;
}

function paintCard(wk, photo, shift) {
  var canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  var ctx = canvas.getContext("2d");
  var PAD = 84;
  var inner = CARD_W - PAD * 2;
  var WHITE = "#ffffff", SOFT = "rgba(255,255,255,0.72)", FAINT = "rgba(255,255,255,0.5)";
  var BLUE = "#4d94ff", GOLD = "#f0c04a";

  // ---- background ----
  var bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, "#0b1222");
  bg.addColorStop(0.55, "#101d38");
  bg.addColorStop(1, "#0a0f1c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  var top = 400;
  if (photo) {
    // the photo fills the top of the card and fades into the background
    var ph = Math.round(CARD_H * 0.5);
    var scale = Math.max(CARD_W / photo.width, ph / photo.height);
    var dw = photo.width * scale, dh = photo.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CARD_W, ph);
    ctx.clip();
    ctx.drawImage(photo, (CARD_W - dw) / 2, (ph - dh) / 2, dw, dh);
    ctx.restore();
    var fade = ctx.createLinearGradient(0, 0, 0, ph);
    fade.addColorStop(0, "rgba(11,18,34,0.55)");
    fade.addColorStop(0.35, "rgba(11,18,34,0.05)");
    fade.addColorStop(1, "#0f1b34");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, CARD_W, ph + 2);
    top = ph + 60;
  } else {
    var glow = ctx.createRadialGradient(CARD_W * 0.85, 190, 0, CARD_W * 0.85, 190, 760);
    glow.addColorStop(0, "rgba(47,124,246,0.42)");
    glow.addColorStop(1, "rgba(47,124,246,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CARD_W, 1000);
  }

  // ---- wordmark ----
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = cardFont(800, 56);
  ctx.fillStyle = WHITE;
  ctx.fillText("Gym", PAD, 160);
  ctx.fillStyle = BLUE;
  ctx.fillText("Social", PAD + ctx.measureText("Gym").width, 160);

  var y = top + shift;
  var prs = prsAt(wk);

  // ---- records ribbon ----
  if (prs.length) {
    var ribbon = prs.length === 1 ? "NEW PERSONAL RECORD" : prs.length + " NEW PERSONAL RECORDS";
    ctx.font = cardFont(700, 32);
    var rw = ctx.measureText(ribbon).width + 56;
    ctx.fillStyle = "rgba(240,192,74,0.16)";
    roundedRect(ctx, PAD, y - 46, rw, 66, 33);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.fillText(ribbon, PAD + 28, y);
    y += 96;
  }

  // ---- title ----
  var firstEx = wk.exercises[0] ? findExercise(wk.exercises[0].exerciseId) : null;
  var title = wk.title || (isCardioWorkout(wk) && firstEx ? firstEx.name : "Workout");
  // big and on two lines if it fits; a long title steps down a size and gets a third
  var titleSize = 112;
  ctx.font = cardFont(800, titleSize);
  if (wrapText(ctx, title, inner, 9).length > 2) {
    titleSize = 86;
    ctx.font = cardFont(800, titleSize);
  }
  ctx.fillStyle = WHITE;
  wrapText(ctx, title, inner, titleSize === 112 ? 2 : 3).forEach(function (line) {
    y += titleSize;
    ctx.fillText(line, PAD, y);
    y += 12;
  });

  // ---- where and when ----
  var gymObj = wk.gymId ? findGym(wk.gymId) : null;
  var where = [gymObj ? gymObj.name : null, calendarDate(wk.performedAt)].filter(Boolean).join("  ·  ");
  ctx.font = cardFont(500, 42);
  ctx.fillStyle = SOFT;
  y += 62;
  ctx.fillText(fitText(ctx, where, inner), PAD, y);
  var together = withText(wk);
  if (together) {
    y += 60;
    ctx.fillText(fitText(ctx, together.replace(/^w/, "W"), inner), PAD, y);
  }

  // ---- headline numbers ----
  var tiles = cardTiles(wk);
  var gap = 24;
  var tw = (inner - gap * (tiles.length - 1)) / tiles.length;
  y += 70;
  tiles.forEach(function (t, i) {
    var x = PAD + i * (tw + gap);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundedRect(ctx, x, y, tw, 210, 28);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = WHITE;
    ctx.font = cardFont(800, tiles.length === 3 ? 68 : 78);
    ctx.fillText(fitText(ctx, t[0], tw - 30), x + tw / 2, y + 112);
    ctx.fillStyle = FAINT;
    ctx.font = cardFont(600, 30);
    ctx.fillText(t[1].toUpperCase(), x + tw / 2, y + 166);
  });
  ctx.textAlign = "left";
  y += 210 + 84;

  // ---- the records, or what was trained ----
  var footerTop = CARD_H - 190;
  var rows;
  if (prs.length) {
    rows = prs.slice(0, 4).map(function (p) { return [p.name, p.display, GOLD]; });
  } else {
    rows = wk.exercises.map(function (blk) {
      var ex = findExercise(blk.exerciseId);
      return [ex ? ex.name : "Exercise",
              summarizeSets(blk.sets, metricOf(blk), blk.equipment, ex && ex.name), SOFT];
    });
  }
  var room = Math.max(0, Math.floor((footerTop - y) / 92));
  var more = rows.length - room;
  if (more > 0) rows = rows.slice(0, Math.max(0, room - 1));
  rows.forEach(function (r) {
    ctx.font = cardFont(600, 40);
    var rightW = Math.min(ctx.measureText(String(r[1])).width, inner * 0.5);
    ctx.textAlign = "right";
    ctx.fillStyle = r[2];
    ctx.fillText(fitText(ctx, r[1], inner * 0.5), CARD_W - PAD, y);
    ctx.textAlign = "left";
    ctx.fillStyle = WHITE;
    ctx.font = cardFont(700, 42);
    ctx.fillText(fitText(ctx, r[0], inner - rightW - 40), PAD, y);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(PAD, y + 30, inner, 2);
    y += 92;
  });
  if (more > 0 && room > 0) {
    ctx.font = cardFont(500, 36);
    ctx.fillStyle = FAINT;
    ctx.fillText("+ " + (more + 1) + " more", PAD, y);
    y += 92;
  }
  var endY = y;

  // ---- footer ----
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(PAD, CARD_H - 170, inner, 2);
  ctx.font = cardFont(700, 44);
  ctx.fillStyle = WHITE;
  var who = currentUser() && state.me.handle ? "@" + state.me.handle
    : (state.me.name && state.me.name !== "You" ? state.me.name : "");
  if (who) ctx.fillText(fitText(ctx, who, inner * 0.55), PAD, CARD_H - 96);
  ctx.textAlign = "right";
  ctx.font = cardFont(500, 34);
  ctx.fillStyle = FAINT;
  ctx.fillText("Logged on GymSocial", CARD_W - PAD, CARD_H - 96);
  ctx.textAlign = "left";
  return { canvas: canvas, endY: endY };
}

function canvasToBlob(canvas) {
  return new Promise(function (resolve, reject) {
    try {
      canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("empty")); }, "image/png");
    } catch (err) { reject(err); }       // a photo the browser won't let a canvas export
  });
}

/* Resolves to a PNG of the card. If the photo turns out to be one the
   browser refuses to export, the card is made again without it. */
function makeWorkoutCard(wk) {
  return cardFontsReady().then(function () { return loadCardPhoto(wk); }).then(function (photo) {
    return canvasToBlob(paintWorkoutCard(wk, photo)).catch(function (err) {
      if (!photo) throw err;
      return canvasToBlob(paintWorkoutCard(wk, null));
    });
  });
}

export function openShareCard(workoutId) {
  var wk = workoutById(workoutId);
  if (!wk) return;
  var el = openListSheet("Share", '<div class="share-wait" id="share-root">Making your picture…</div>');
  makeWorkoutCard(wk).then(function (blob) {
    if (!document.getElementById("share-root")) return;      // closed, or showing something else by now
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(blob);
    var name = "gymsocial-" + String(wk.title || "workout").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".png";
    var file = null;
    try { file = new File([blob], name, { type: "image/png" }); } catch (e) { /* very old browser */ }
    var canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    el.innerHTML = '<div id="share-root">' +
      '<img class="share-img" id="share-img" src="' + shareUrl + '" alt="Picture of ' + esc(wk.title || "your workout") + ' to share">' +
      (canShare ? '<button class="btn btn-primary btn-block" id="share-go">Share</button>' : '') +
      '<a class="btn btn-ghost btn-block share-save" id="share-save" href="' + shareUrl + '" download="' + esc(name) + '">Save picture</a>' +
      '<p class="setting-help">You can also press and hold the picture to save or copy it.</p>' +
    '</div>';
    var go = el.querySelector("#share-go");
    if (go) go.addEventListener("click", function () {
      navigator.share({ files: [file], title: "GymSocial" }).catch(function () { /* closed the share sheet */ });
    });
  }).catch(function () {
    if (document.getElementById("share-root")) {
      el.innerHTML = '<div class="empty-state" id="share-root">Couldn’t make the picture. Close this and try again.</div>';
    }
  });
}

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls this in a fixed order. */

export function startFeed() {
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-profile]");
    if (!t) return;
    // a face or name inside a bigger button opens the person, not the workout
    e.preventDefault();
    e.stopPropagation();
    openProfileById(t.getAttribute("data-profile"));
  }, true);
  document.getElementById("friends-manage").addEventListener("click", openFriendsManage);
}
