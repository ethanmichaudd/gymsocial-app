/**
 * The first-time walkthrough.
 *
 * Four cards you swipe through (or tap Next): logging, friends, gyms, and a
 * weekly goal to aim for. The last card gets you going: an account, or
 * straight to logging. Shown once per phone, to someone opening the app for
 * the very first time; Settings -> Take the tour shows it again.
 */
import { currentUser } from "./store.js";
import { activateTab, persist, state } from "./core.js";
import { openAuth } from "./settings.js";

var SEEN_KEY = "gymsocial_tour_v1";

/* Was anything saved on this phone before this visit? Read as the file
   loads, before the app saves its starting data for a first-time visitor
   (the same test news.js uses). */
var hadSavedData = false;
try { hadSavedData = localStorage.getItem("gymsocial_v1") !== null; } catch (e) { /* storage blocked */ }

function seen() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch (e) { return true; }   // can't remember: don't nag
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) { /* storage blocked */ }
}

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

/* Each card: a little picture made of the app's own pieces, a title, a line. */
var CARDS = [
  {
    art: '<div class="tour-art tour-art-log">' +
      '<div class="tour-set"><span class="tour-idx">1</span><span class="tour-box is-light">5</span><span class="tour-box is-light">185</span><span class="tour-unit">lb</span></div>' +
      '<div class="tour-chips"><span>&minus;2.5</span><span>+2.5</span><span>+5</span><span>+10</span></div>' +
      '<div class="tour-last">Last time <b>5 @ 185lb</b></div>' +
    '</div>',
    title: "Log it in seconds",
    text: "Your last numbers are already filled in. Type over them, tap +5, done. Cardio too."
  },
  {
    art: '<div class="tour-art tour-art-friends">' +
      '<div class="tour-faces"><span class="tour-face is-live">MJ</span><span class="tour-face is-today">DP</span><span class="tour-face">SK</span><span class="tour-face is-add">+</span></div>' +
      '<div class="tour-board"><span class="tour-tag">This week</span>&#129351; <b>Maya</b> 4 &middot; <b>You</b> 3</div>' +
      '<div class="tour-reacts"><span>&#128170; 3</span><span>&#128293; 1</span><span>&#128172; 2</span></div>' +
    '</div>',
    title: "Train with your friends",
    text: "See who trained today, react and comment, and race them up the weekly leaderboard."
  },
  {
    art: '<div class="tour-art tour-art-gym">' +
      '<div class="tour-map"><span class="tour-pin" style="left:28%;top:38%"></span><span class="tour-pin is-mine" style="left:58%;top:52%"></span><span class="tour-pin" style="left:74%;top:26%"></span></div>' +
      '<div class="tour-here"><span class="tour-dot"></span><b>Maya</b> is at Planet Fitness &middot; 25m</div>' +
    '</div>',
    title: "Your gym is a place",
    text: "Find it on the map, check in, see who's there right now and what people train there."
  },
  {
    goal: true,
    art: '<div class="tour-art tour-art-goal"><span class="tour-big" id="tour-goal-num">3</span><span class="tour-big-label">workouts a week</span></div>',
    title: "Set your weekly goal",
    text: "Hit it every week to build a streak. You can change it any time in Settings."
  }
];

var current = 0;

function tourHtml() {
  var signedIn = !!currentUser();
  var goal = state.settings.weeklyGoal || 3;
  return '<div class="tour-top"><button type="button" class="tour-skip" id="tour-skip">Skip</button></div>' +
    '<div class="tour-track" id="tour-track">' + CARDS.map(function (c, i) {
      return '<section class="tour-card" data-tour-card="' + i + '" aria-label="' + (i + 1) + ' of ' + CARDS.length + '">' +
        c.art +
        '<h2 class="tour-title">' + c.title + '</h2>' +
        '<p class="tour-text">' + c.text + '</p>' +
        (c.goal
          ? '<div class="tour-goals" role="radiogroup" aria-label="Workouts a week">' + [2, 3, 4, 5, 6].map(function (n) {
              return '<button type="button" class="tour-goal' + (n === goal ? " is-on" : "") + '" role="radio" aria-checked="' +
                (n === goal) + '" data-tour-goal="' + n + '">' + n + '</button>';
            }).join("") + '</div>'
          : '') +
      '</section>';
    }).join("") + '</div>' +
    '<div class="tour-dots" aria-hidden="true">' + CARDS.map(function (c, i) {
      return '<span class="tour-dot-i' + (i === 0 ? " is-on" : "") + '"></span>';
    }).join("") + '</div>' +
    '<div class="tour-foot" id="tour-foot">' +
      '<button type="button" class="btn btn-primary btn-block tour-next" id="tour-next">Next</button>' +
      '<div class="tour-end" id="tour-end" hidden>' +
        (signedIn
          ? '<button type="button" class="btn btn-primary btn-block" id="tour-start">Log your first workout</button>'
          : '<button type="button" class="btn btn-primary btn-block" id="tour-signup">Create an account</button>' +
            '<button type="button" class="btn btn-ghost btn-block" id="tour-signin">I have an account</button>' +
            '<button type="button" class="tour-later" id="tour-start">Just start logging</button>') +
      '</div>' +
    '</div>';
}

function show(i) {
  var track = document.getElementById("tour-track");
  if (!track) return;
  current = Math.max(0, Math.min(CARDS.length - 1, i));
  track.scrollTo({ left: current * track.clientWidth, behavior: "smooth" });
  sync();
}

// dots, and Next vs the last card's buttons, follow whichever card is showing
function sync() {
  var last = current === CARDS.length - 1;
  document.querySelectorAll(".tour-dot-i").forEach(function (d, i) { d.classList.toggle("is-on", i === current); });
  document.getElementById("tour-next").hidden = last;
  document.getElementById("tour-end").hidden = !last;
  document.getElementById("tour-skip").style.visibility = last ? "hidden" : "visible";
}

function finish(then) {
  markSeen();
  state.settings.tourDone = true;
  persist();
  var el = document.getElementById("tour");
  el.classList.remove("open");
  setTimeout(function () { el.hidden = true; el.innerHTML = ""; }, 250);
  if (then) then();
}

export function openTour() {
  var el = document.getElementById("tour");
  el.innerHTML = tourHtml();
  el.hidden = false;
  current = 0;
  requestAnimationFrame(function () { el.classList.add("open"); });

  var track = document.getElementById("tour-track");
  var t = null;
  track.addEventListener("scroll", function () {
    clearTimeout(t);
    t = setTimeout(function () {
      var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== current) { current = i; sync(); }
    }, 60);
  });
  document.getElementById("tour-next").addEventListener("click", function () { show(current + 1); });
  document.getElementById("tour-skip").addEventListener("click", function () { finish(); });
  el.querySelectorAll("[data-tour-goal]").forEach(function (b) {
    b.addEventListener("click", function () {
      var n = Number(b.getAttribute("data-tour-goal"));
      state.settings.weeklyGoal = n;
      state.settings.streakMode = "weekly";
      persist();
      el.querySelectorAll("[data-tour-goal]").forEach(function (x) {
        x.classList.toggle("is-on", x === b);
        x.setAttribute("aria-checked", x === b ? "true" : "false");
      });
      document.getElementById("tour-goal-num").textContent = n;
    });
  });
  var go = function (id, fn) { var b = document.getElementById(id); if (b) b.addEventListener("click", fn); };
  go("tour-start", function () { finish(function () { activateTab("log"); }); });
  go("tour-signup", function () { finish(function () { openAuth("signup"); }); });
  go("tour-signin", function () { finish(function () { openAuth("signin"); }); });
  sync();
}

/* At startup: only for someone who has never opened the app on this phone,
   and not when they arrived through a link or a notification. */
export function startTour() {
  if (seen()) return false;
  if (usedBefore() || state.settings.tourDone) { markSeen(); return false; }
  if (/[?&](workout|friends|inbox|recap|add)=/.test(location.search)) return false;
  openTour();
  return true;
}
