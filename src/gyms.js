/**
 * Gyms as places: adding and finding gyms, the shared directory, pins and the
 * map, the Gyms tab, a gym's page, regulars and badges.
 */

import {
  adoptGym, currentUser, fetchGymDirectory, fetchGymStats, fetchMapConfig, saveGymLocation
} from "./store.js";
import {
  canAskNearby, canLocate, closestGym, distanceKm, formatDistance, locateGym, lookUpNearby,
  darkByFilter, mapAttribution, mapConfig, nameLikeness, nearbyKnown, placeOf, setMapConfig, tileUrlFor
} from "./geo.js";
import {
  activateTab, avatarHtml, calendarDate, closeListSheet, currentTab, esc, findExercise,
  findUser, friendsOf, gymAddress, gymKey, gymLabel, gymsOf, localDayKey, MONTHS_LONG,
  myWorkouts, openConfirm, openListSheet, persist, showToast, signedOut, state, titleCase, uid,
  workoutsOf
} from "./core.js";
import { renderHome } from "./home.js";
import { liveFriends, sinceShort, startLive } from "./live.js";
import { draft, draftHasContent, editDraft, renderLog, resetDraft } from "./log.js";

/* Opens the gyms sheet; tapping a gym opens its detail page. */
function openGymsSheet(userId) {
  var u = findUser(userId);
  var rows = gymsOf(userId);
  var isMe = userId === state.me.id;
  var body = rows.length
    ? rows.map(function (row) {
        return '<button class="gym-row" data-gym-sheet="' + row.gym.id + '" style="width:100%;font-family:inherit;text-align:left;">' +
          '<span><span class="gym-row-name" style="display:block;">' + esc(row.gym.name) + '</span>' +
          '<span class="gym-row-city" style="display:block;">' + (row.gym.city ? esc(row.gym.city) + ' &middot; ' : '') +
          row.sessions + (row.sessions === 1 ? ' session' : ' sessions') + '</span></span>' +
          '<span class="chevron">&rsaquo;</span></button>';
      }).join("")
    : '<div class="empty-state">' + (isMe
        ? "You haven't checked into a gym yet."
        : esc(u.name.split(" ")[0]) + " hasn't checked into a gym yet.") + '</div>';
  var el = openListSheet(isMe ? "Your Gyms" : u.name.split(" ")[0] + "'s Gyms", body);
  el.querySelectorAll("[data-gym-sheet]").forEach(function (row) {
    row.addEventListener("click", function () {
      closeListSheet();
      openGymModal(row.getAttribute("data-gym-sheet"));
    });
  });
}

/* ----------------------------- gyms ----------------------------- */

/* What you train at a gym, most-logged first. Becomes a community stat
   again when other people are in the picture. */
function gymExerciseBreakdown(gymId) {
  var counts = {};
  myWorkouts().filter(function (w) { return w.gymId === gymId; }).forEach(function (wk) {
    wk.exercises.forEach(function (we) {
      counts[we.exerciseId] = (counts[we.exerciseId] || 0) + 1;
    });
  });
  return Object.keys(counts).map(function (exId) {
    var exObj = findExercise(exId);
    return { name: exObj ? exObj.name : "Exercise", count: counts[exId] };
  }).sort(function (a, b) { return b.count - a.count; });
}

export function renderGyms() {
  var q = (document.getElementById("gym-search").value || "").toLowerCase();
  var list = state.gyms.filter(function (g) {
    return (g.name + " " + gymAddress(g)).toLowerCase().indexOf(q) !== -1;
  });
  var el = document.getElementById("gym-list");
  if (!list.length) { el.innerHTML = '<div class="empty-state">No gyms match "' + esc(q) + '".</div>'; return; }
  el.innerHTML = list.map(function (g) {
    var n = myWorkouts().filter(function (w) { return w.gymId === g.id; }).length;
    var sub = [gymAddress(g), n + (n === 1 ? " session" : " sessions")].filter(Boolean).join(" \u00b7 ");
    return '<div class="gym-row" data-gym="' + g.id + '">' +
      '<div><div class="gym-row-name">' + esc(g.name) + '</div>' +
      '<div class="gym-row-city">' + esc(sub) + '</div></div>' +
      '<span class="chevron">&rsaquo;</span></div>';
  }).join("");
  el.querySelectorAll("[data-gym]").forEach(function (row) {
    row.addEventListener("click", function () { openGymModal(row.getAttribute("data-gym")); });
  });
}

/* ----------------------------- add a gym ----------------------------- */

var gymAddDone = null;
var gymEditing = null;      // the gym being changed, or null when adding

function gymAddFields() {
  return {
    name: document.getElementById("gym-add-name"),
    street: document.getElementById("gym-add-street"),
    city: document.getElementById("gym-add-city"),
    state: document.getElementById("gym-add-state"),
    isPrivate: document.getElementById("gym-add-private")
  };
}

/* Shows what the gym will be called before you commit to it, so the
   "Name - City, ST" shape is never a surprise. */
function updateGymAddPreview() {
  var f = gymAddFields();
  var draftGym = {
    id: gymEditing ? gymEditing.id : null,
    name: titleCase(f.name.value) || "Name",
    street: titleCase(f.street.value),
    city: titleCase(f.city.value),
    state: f.state.value.trim().toUpperCase()
  };
  document.getElementById("gym-add-preview").innerHTML =
    "Saves as <strong>" + esc(gymLabel(draftGym)) + "</strong>";
  // only said when it's true: a private gym's address never leaves the app
  document.getElementById("gym-add-note").hidden = f.isPrivate.checked || !mapConfig().geocoding;
}

/* One sheet for both jobs: with a gym it edits that one, without it adds
   a new one (optionally with the name already typed in). Same fields, same
   preview, same validation. */
function openGymAdd(onSaved, gym, name) {
  gymAddDone = onSaved;
  gymEditing = gym || null;
  var f = gymAddFields();
  f.name.value = gym ? gym.name : (name || "");
  f.street.value = gym ? (gym.street || "") : "";
  f.city.value = gym ? (gym.city || "") : "";
  f.state.value = gym ? (gym.state || "") : "";
  f.isPrivate.checked = !!(gym && gym.private);

  document.getElementById("gym-add-title").textContent = gym ? "Edit gym" : "Add gym";
  document.getElementById("gym-add-save").textContent = gym ? "Save changes" : "Save gym";
  var remove = document.getElementById("gym-add-remove");
  remove.hidden = !gym;
  remove.textContent = "Remove gym";
  remove.classList.remove("is-armed");

  updateGymAddPreview();
  document.getElementById("gym-add-overlay").classList.add("open");
  if (!gym) f.name.focus();
}

function closeGymAdd() {
  document.getElementById("gym-add-overlay").classList.remove("open");
  gymAddDone = null;
  gymEditing = null;
}

/* ----------------------------- gyms as places ----------------------------- */

/* A gym is a row in one shared directory, so three lists on this phone can
   mention the same one: your own gyms, the gyms your friends' workouts
   use, and the directory itself. Everything below reads them through
   allKnownGyms(), which folds the three into one entry per gym. */

export function gymDirectory() {
  return signedOut() ? [] : (state.gymDirectory || []);
}

function allKnownGyms() {
  var byId = {};
  var out = [];
  var add = function (g, source) {
    var e = byId[g.id];
    if (!e) {
      e = byId[g.id] = {
        id: g.id, name: g.name, street: g.street || "", city: g.city || "", state: g.state || "",
        lat: null, lng: null, people: null, total: null, mine: false, private: false
      };
      out.push(e);
    }
    if (source === "mine") {
      // your copy may hold an edit that hasn't synced yet, so its words win
      e.mine = true;
      e.name = g.name; e.street = g.street || ""; e.city = g.city || ""; e.state = g.state || "";
      e.private = !!g.private;
    }
    if (source === "directory") {
      e.people = g.people;
      e.total = g.total;
      if (g.private) e.private = true;
    }
    if (g.lat != null && g.lng != null && (e.lat == null || source === "mine")) {
      e.lat = g.lat;
      e.lng = g.lng;
    }
  };
  gymDirectory().forEach(function (g) { add(g, "directory"); });
  if (!signedOut()) (state.foreignGyms || []).forEach(function (g) { add(g, "friends"); });
  state.gyms.forEach(function (g) { add(g, "mine"); });
  return out;
}

export function knownGym(id) {
  return allKnownGyms().filter(function (g) { return g.id === id; })[0];
}

/* Which friends train where, from the workouts already on this phone.
   gym id -> { users: [friend, ...], today: [friend id, ...] } */
function friendsAtGyms() {
  var map = {};
  var today = localDayKey(new Date().toISOString());
  friendsOf(state.me.id).forEach(function (u) {
    workoutsOf(u.id).forEach(function (w) {
      if (!w.gymId) return;
      var e = map[w.gymId] = map[w.gymId] || { users: [], today: [] };
      if (e.users.indexOf(u) === -1) e.users.push(u);
      if (localDayKey(w.performedAt) === today && e.today.indexOf(u.id) === -1) e.today.push(u.id);
    });
  });
  return map;
}

/* ---- the shared directory ---- */

var directoryAt = 0;
var directoryBusy = null;

/* Fetches the directory (and where the map comes from). Throttled unless
   forced; redraws the Gyms tab when it lands. */
function refreshDirectory(force) {
  if (!currentUser()) return Promise.resolve();
  if (directoryBusy) return directoryBusy;
  if (!force && Date.now() - directoryAt < 60000) return Promise.resolve();
  directoryAt = Date.now();
  directoryBusy = Promise.all([fetchGymDirectory(), fetchMapConfig()]).then(function (res) {
    directoryBusy = null;
    if (res[1]) { state.mapConfig = res[1]; setMapConfig(res[1]); }
    if (res[0]) {
      // a pin this phone worked out but the database couldn't store yet
      var before = {};
      (state.gymDirectory || []).forEach(function (g) { before[g.id] = g; });
      res[0].forEach(function (g) {
        var old = before[g.id];
        if (g.lat == null && old && old.lat != null) { g.lat = old.lat; g.lng = old.lng; }
      });
      state.gymDirectory = res[0];
      // your copy follows the shared pin, unless you just moved it yourself
      var shared = {};
      res[0].forEach(function (g) { shared[g.id] = g; });
      state.gyms.forEach(function (g) {
        var d = shared[g.id];
        if (d && d.lat != null && !g.locDirty) { g.lat = d.lat; g.lng = d.lng; }
      });
    }
    persist();
    if (currentTab === "gyms") renderPlaces();
  }, function () {
    directoryBusy = null;        // offline: what's on this phone is still shown
  });
  return directoryBusy;
}

/* ---- pins ---- */

/* Writes a pin into every local copy of a gym. Returns true when the gym
   is on your own list, in which case the normal sync sends it. */
function setGymPinLocal(id, lat, lng) {
  var hit = function (g) { return g.id === id; };
  [state.gyms, state.foreignGyms || [], state.gymDirectory || []].forEach(function (list) {
    var g = list.filter(hit)[0];
    if (g) { g.lat = lat; g.lng = lng; }
  });
  var mine = state.gyms.filter(hit)[0];
  if (mine) {
    if (lat != null) mine.locDirty = true; else delete mine.locDirty;
  }
  persist();
  return !!mine;
}

/* Gyms added before the map existed have an address but no pin. Each is
   looked up once, slowly (the lookup service allows one request a second
   and the queue in geo.js keeps to that), and the answer is saved for
   everyone, so no other phone has to ask again. */
var pinLookups = {};          // gym id -> "busy" | "done": once per session each
var pinLookupBudget = 25;     // and only so many in one session
var placesRedraw = null;

function lookUpPin(id) {
  var g = knownGym(id);
  if (!g || g.lat != null || pinLookups[id] || !canLocate(g)) return Promise.resolve(null);
  pinLookups[id] = "busy";
  return locateGym(g).then(function (hit) {
    pinLookups[id] = "done";
    if (hit) {
      var mine = setGymPinLocal(id, hit.lat, hit.lng);
      if (!mine && currentUser()) {
        saveGymLocation(id, hit.lat, hit.lng).catch(function () { /* someone who trains there can place it */ });
      }
    }
    clearTimeout(placesRedraw);
    placesRedraw = setTimeout(function () {
      if (currentTab === "gyms") renderPlaces();
      if (openGymId === id && gymModalIsOpen() && !gymMoving) drawGymPage();
    }, 150);
    return hit;
  }, function () {
    delete pinLookups[id];     // couldn't reach the service: worth another go later
    return null;
  });
}

/* ---- the map ---- */

var Leaflet = null;
var leafletLoading = null;

/* The map library is only fetched the first time a map is shown, so it
   costs nothing on the screens that don't have one. */
function loadLeaflet() {
  if (!leafletLoading) {
    leafletLoading = Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(function (mods) {
        Leaflet = mods[0].default || mods[0];
        return Leaflet;
      });
    leafletLoading.catch(function () { leafletLoading = null; });   // offline: try again next time
  }
  return leafletLoading;
}

/* The map's look follows the theme: a light street map, or a dark one.
   Every live map swaps when the theme changes. */
var tiledMaps = [];
function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }
function addTiles(map) {
  var dark = isDark();
  map._gsTiles = Leaflet.tileLayer(tileUrlFor(dark), {
    maxZoom: 19, attribution: mapAttribution()
  }).addTo(map);
  // one style only: the dark theme inverts it (style.css)
  map.getContainer().classList.toggle("tiles-invert", darkByFilter());
  map._gsDark = dark;
  if (map.attributionControl) map.attributionControl.setPrefix(false);
  tiledMaps = tiledMaps.filter(function (m) { return m._container && document.body.contains(m._container); });
  tiledMaps.push(map);
}
if (typeof MutationObserver !== "undefined") {
  new MutationObserver(function () {
    var dark = isDark();
    tiledMaps.forEach(function (m) {
      if (m._gsDark === dark || !m._gsTiles) return;
      m._gsTiles.setUrl(tileUrlFor(dark));
      m._gsDark = dark;
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function pinIcon(kind) {
  return Leaflet.divIcon({
    className: "gym-pin-wrap",
    html: '<span class="gym-pin' + (kind ? " " + kind : "") + '"></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 28]
  });
}

var MAP_OFF_HTML = '<div class="map-off">The map needs a connection.</div>';
var NOWHERE = [39.5, -98.35];     // middle of the US, zoomed out: shown only when there's nothing to show

/* ----------------------------- gyms tab -----------------------------
   Like Apple Maps: the map fills the screen and a sheet you drag up and
   down sits over it. With nothing typed, the sheet lists the gyms in the
   part of the map you're looking at: first the ones on GymSocial, then
   real gyms from the map's data that nobody has added yet (one tap adds
   one, pin and all). Move the map and the list follows. */

var placesQuery = "";
var placesLoc = null;         // where you are, after "Near me". Never stored or sent anywhere.
var placesLocating = false;
var placesMap = null;
var placesPins = null;
var placesFit = null;         // what the map was last framed around
var placesPinKey = null;
var placesTouched = false;    // you've moved the map yourself since then
var placesView = null;        // the part of the map above the sheet: { s, w, n, e, center }
var nearbyBusy = false;
var nearbyTimer = null;

function placesRows() {
  var q = placesQuery.trim().toLowerCase();
  var friends = friendsAtGyms();
  var visits = {};
  myWorkouts().forEach(function (w) { if (w.gymId) visits[w.gymId] = (visits[w.gymId] || 0) + 1; });
  var home = state.settings.homeGymId;

  var rows = allKnownGyms().map(function (g) {
    var f = friends[g.id] || { users: [], today: [] };
    return {
      gym: g, friends: f.users, today: f.today.length, visits: visits[g.id] || 0, home: g.id === home,
      km: placesLoc && g.lat != null ? distanceKm(placesLoc, g) : null
    };
  }).filter(function (r) {
    if (q) return (r.gym.name + " " + gymAddress(r.gym)).toLowerCase().indexOf(q) !== -1;
    // nothing typed: places somebody actually trains at, plus your own.
    // (total is null when the database can't count yet -- then show them all)
    return r.gym.mine || r.friends.length || r.gym.total == null || r.gym.total > 0;
  });

  rows.sort(function (a, b) {
    if (placesLoc) {
      if ((a.km == null) !== (b.km == null)) return a.km == null ? 1 : -1;
      if (a.km != null && a.km !== b.km) return a.km - b.km;
    }
    // your gym, then where friends train, then anywhere you've been, then the busiest
    return (b.home - a.home) || (b.friends.length - a.friends.length) ||
      (b.visits - a.visits) || (b.gym.mine - a.gym.mine) ||
      ((b.gym.people || 0) - (a.gym.people || 0)) ||
      a.gym.name.localeCompare(b.gym.name);
  });
  return rows;
}

function inView(g) {
  var v = placesView;
  return !!v && g.lat != null && g.lat >= v.s && g.lat <= v.n && g.lng >= v.w && g.lng <= v.e;
}

/* Real gyms from the map's data, in view, that aren't on GymSocial yet:
   anything close to a known gym with a similar name is that gym. */
function suggestions(known) {
  if (!placesView) return [];
  var q = placesQuery.trim().toLowerCase();
  var all = allKnownGyms();
  var from = placesLoc || placesView.center;
  return nearbyKnown(placesView).filter(function (p) {
    if (q && (p.name + " " + gymAddress(p)).toLowerCase().indexOf(q) === -1) return false;
    return !all.some(function (g) {
      if (g.lat == null) return nameLikeness(g.name, p.name) >= 0.8 && (!g.city || !p.city || g.city.toLowerCase() === p.city.toLowerCase());
      var km = distanceKm(g, p);
      return km < 0.06 || (km < 0.4 && nameLikeness(g.name, p.name) >= 0.5);
    });
  }).map(function (p) {
    return { place: p, km: distanceKm(from, p) };
  }).sort(function (a, b) { return a.km - b.km; }).slice(0, 12);
}

function pinKind(r) {
  return r.home ? "is-home" : (r.friends.length || r.gym.mine) ? "is-yours" : "";
}

function placeRowHtml(r) {
  var g = r.gym;
  var bits = [];
  var here = liveFriends().filter(function (l) { return l.gymId === g.id; }).length;
  if (here) bits.push('<span class="live-dot"></span>' + here + ' here now');
  if (r.friends.length) {
    bits.push('<span class="avatar-stack">' + r.friends.slice(0, 3).map(function (u) {
      return avatarHtml(u);
    }).join("") + '</span>' + r.friends.length + (r.friends.length === 1 ? " friend" : " friends") +
      (r.today ? ", " + r.today + " today" : ""));
  }
  if (g.people) bits.push(g.people + (g.people === 1 ? " person" : " people") + " this month");
  if (!bits.length) bits.push(esc(g.street || (r.visits ? r.visits + (r.visits === 1 ? " session" : " sessions") : "No one has logged here yet")));
  var tag = r.home ? '<span class="place-tag">My gym</span>'
    : g.private ? '<span class="place-tag is-muted">Private</span>' : '';
  return '<button class="place-row" data-place="' + esc(g.id) + '">' +
    '<span class="place-pin ' + pinKind(r) + '">' + PIN_SVG + '</span>' +
    '<span class="person-body">' +
      '<span class="person-name">' + esc(gymLabel(g)) + tag + '</span>' +
      '<span class="person-sub place-sub">' + bits.join(' <span class="dot">&middot;</span> ') + '</span>' +
    '</span>' +
    (r.km != null ? '<span class="place-km">' + esc(formatDistance(r.km)) + '</span>' : '') +
    '<span class="chevron">&rsaquo;</span>' +
  '</button>';
}

function suggestionRowHtml(s) {
  var p = s.place;
  var where = p.street || p.city || "";
  return '<button class="place-row is-osm" data-osm="' + esc(p.id) + '">' +
    '<span class="place-pin is-osm">' + PIN_SVG + '</span>' +
    '<span class="person-body">' +
      '<span class="person-name">' + esc(p.name) + '</span>' +
      '<span class="person-sub place-sub">' + (where ? esc(where) + ' <span class="dot">&middot;</span> ' : '') +
        'Not on GymSocial yet</span>' +
    '</span>' +
    '<span class="place-km">' + esc(formatDistance(s.km)) + '</span>' +
    '<span class="place-add" aria-hidden="true">+</span>' +
  '</button>';
}

var PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
  'stroke-linejoin="round"><path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z"/>' +
  '<circle cx="12" cy="10" r="2.4"/></svg>';
var NEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round"><path d="M20 4 4 11l7 2 2 7z"/></svg>';

/* Just the sheet's list: cheap, so it can follow the map as it moves. */
function renderPlacesList(rows) {
  rows = rows || placesRows();
  var q = placesQuery.trim();
  var el = document.getElementById("places-list");
  var html = "";

  if (!placesLoc) {
    html += '<button class="near-card" id="places-near-card"' + (placesLocating ? " disabled" : "") + '>' +
      '<span class="near-card-icon">' + NEAR_SVG + '</span>' +
      '<span class="person-body"><span class="person-name">' + (placesLocating ? "Finding you&hellip;" : "Gyms closest to you") + '</span>' +
      '<span class="person-sub">Use your location to see what&rsquo;s nearby</span></span></button>';
  }

  var here = q || !placesView ? rows : rows.filter(function (r) { return inView(r.gym); });
  var away = q || !placesView ? [] : rows.filter(function (r) { return !inView(r.gym); });
  var more = suggestions();

  if (q) html += '<div class="sheet-head">Results</div>';
  else html += '<div class="sheet-head">' + (placesLoc ? "Near you" : "In this area") +
    (here.length ? ' <span class="sheet-count">' + here.length + '</span>' : '') + '</div>';
  html += here.map(placeRowHtml).join("");
  if (!here.length && !more.length) {
    html += '<div class="empty-state">' + (q
      ? 'No gym matches “' + esc(q) + '”. If it’s new here, add it.'
      : allKnownGyms().length ? "No gyms on GymSocial here yet. Move the map, or add one."
      : "No gyms yet. Add the one you train at and it shows up here.") + '</div>';
  }

  if (more.length) {
    html += '<div class="sheet-head">' + (q ? "On the map" : "More gyms here") +
      '<span class="sheet-sub">Tap one to add it</span></div>' + more.map(suggestionRowHtml).join("");
  } else if (nearbyBusy) {
    html += '<div class="sheet-loading">Looking for more gyms here&hellip;</div>';
  }

  if (away.length) html += '<div class="sheet-head">Elsewhere</div>' + away.map(placeRowHtml).join("");

  html += '<button class="btn btn-ghost btn-block" id="places-add">+ Add a gym</button>';
  if (signedOut()) {
    html += '<p class="places-hint">Sign in to see where your friends train and how busy each gym is. ' +
      '<button class="text-link" data-open-auth="signin">Sign in</button></p>';
  }
  el.innerHTML = html;

  el.querySelectorAll("[data-place]").forEach(function (row) {
    row.addEventListener("click", function () { openGymModal(row.getAttribute("data-place")); });
  });
  el.querySelectorAll("[data-osm]").forEach(function (row) {
    row.addEventListener("click", function () {
      var id = row.getAttribute("data-osm");
      var hit = more.filter(function (s) { return s.place.id === id; })[0];
      if (hit) openSuggestion(hit.place);
    });
  });
  var card = el.querySelector("#places-near-card");
  if (card) card.addEventListener("click", function () { locateMe(false); });
  el.querySelector("#places-add").addEventListener("click", function () {
    openGymAdd(function (g) {
      renderPlaces();
      showToast("Added " + gymLabel(g) + ".");
    }, null, titleCase(placesQuery));
  });
}

export function renderPlaces() {
  var rows = placesRows();
  placeSheet();                  // sized before anything else, so it never flashes full-screen
  renderPlacesList(rows);
  drawPlacesMap(rows);
  refreshDirectory(false);
  // you said "near me" before: find you again (the choice is remembered, never the place)
  if (!placesLoc && !placesLocating && state.settings.nearMe) locateMe(true);

  // fill in pins for gyms that have an address but aren't on the map yet
  rows.forEach(function (r) {
    if (pinLookupBudget <= 0 || r.gym.lat != null || pinLookups[r.gym.id] || !canLocate(r.gym)) return;
    pinLookupBudget--;
    lookUpPin(r.gym.id);
  });
}

/* ---- the sheet ----
   Three resting places: just the search box, about half the screen, or
   nearly all of it. Drag the handle (or the list, once it's scrolled to
   the top) and it settles at the nearest one; a flick goes one further. */
var SNAPS = ["peek", "half", "full"];
var sheetSnap = "half";

function sheetSizes() {
  var screen = document.getElementById("screen-gyms");
  var h = screen.clientHeight || 600;
  var top = 64;                                // room for the locate button above a full sheet
  return { h: h, sheetH: h - top, peek: 88, half: Math.round(h * 0.46), full: h - top };
}

function sheetShown(snap) {
  var z = sheetSizes();
  return Math.min(z[snap || sheetSnap], z.sheetH);
}

function placeSheet(snap, animate) {
  var sheet = document.getElementById("places-sheet");
  if (!sheet) return;
  if (snap) sheetSnap = snap;
  var z = sheetSizes();
  sheet.style.height = z.sheetH + "px";
  sheet.classList.toggle("is-dragging", animate === false);
  sheet.style.transform = "translateY(" + (z.sheetH - sheetShown()) + "px)";
  sheet.setAttribute("data-snap", sheetSnap);
  document.getElementById("places-grab").setAttribute("aria-label",
    sheetSnap === "full" ? "Show more of the map" : "Show more gyms");
  updateView();
}

function wireSheet() {
  var sheet = document.getElementById("places-sheet");
  var body = document.getElementById("places-body");
  var grab = document.getElementById("places-grab");
  var drag = null;

  var start = function (y) {
    var z = sheetSizes();
    drag = { y0: y, t0: Date.now(), base: z.sheetH - sheetShown(), y: y, z: z };
    sheet.classList.add("is-dragging");
  };
  var move = function (y) {
    drag.y = y;
    var top = Math.max(0, Math.min(drag.z.sheetH - drag.z.peek, drag.base + (y - drag.y0)));
    sheet.style.transform = "translateY(" + top + "px)";
  };
  var end = function () {
    var d = drag;
    drag = null;
    sheet.classList.remove("is-dragging");
    if (!d) return;
    var dy = d.y - d.y0;
    var shown = d.z.sheetH - Math.max(0, d.base + dy);
    var fast = Math.abs(dy) > 30 && Math.abs(dy) / Math.max(1, Date.now() - d.t0) > 0.5;
    var i = SNAPS.indexOf(sheetSnap);
    var next;
    if (fast) next = SNAPS[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))];
    else next = SNAPS.slice().sort(function (a, b) { return Math.abs(d.z[a] - shown) - Math.abs(d.z[b] - shown); })[0];
    if (Math.abs(dy) < 6) next = sheetSnap;
    else grab._dragAt = Date.now();          // the click that ends a drag isn't a tap
    placeSheet(next);
  };

  // the handle and the search row: mouse and touch alike
  [grab, sheet.querySelector(".places-search")].forEach(function (zone) {
    zone.addEventListener("pointerdown", function (e) {
      if (e.target.closest("input, button:not(#places-grab)")) return;
      if (e.button !== undefined && e.button !== 0) return;
      zone.setPointerCapture && zone.setPointerCapture(e.pointerId);
      start(e.clientY);
      var mv = function (ev) { if (drag) move(ev.clientY); };
      var up = function () {
        zone.removeEventListener("pointermove", mv);
        zone.removeEventListener("pointerup", up);
        zone.removeEventListener("pointercancel", up);
        end();
      };
      zone.addEventListener("pointermove", mv);
      zone.addEventListener("pointerup", up);
      zone.addEventListener("pointercancel", up);
    });
  });
  // a tap on the handle steps through the sizes
  grab.addEventListener("click", function () {
    if (grab._dragAt && Date.now() - grab._dragAt < 400) return;
    placeSheet(sheetSnap === "full" ? "half" : sheetSnap === "half" ? "full" : "half");
  });

  // the list: below full size a drag moves the sheet; at full size it
  // scrolls, until it's back at the top and you keep pulling down
  var t = null;
  body.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    t = { y0: e.touches[0].clientY, live: false };
  }, { passive: true });
  body.addEventListener("touchmove", function (e) {
    if (!t) return;
    var y = e.touches[0].clientY, dy = y - t.y0;
    if (!t.live) {
      if (Math.abs(dy) < 6) return;
      var wantsSheet = sheetSnap !== "full" ? true : (dy > 0 && body.scrollTop <= 0);
      if (!wantsSheet) { t = null; return; }
      t.live = true;
      start(t.y0);
    }
    e.preventDefault();
    move(y);
  }, { passive: false });
  var tend = function () { if (t && t.live) end(); t = null; };
  body.addEventListener("touchend", tend);
  body.addEventListener("touchcancel", tend);

  window.addEventListener("resize", function () { if (currentTab === "gyms") placeSheet(); });
}

/* ---- the map ---- */

/* The part of the map you can see, above the sheet. The list and the
   nearby lookup both use it. */
function updateView() {
  if (!placesMap) return;
  var size = placesMap.getSize();
  var bottom = Math.max(60, size.y - sheetShown());
  var nw = placesMap.containerPointToLatLng([0, 0]);
  var se = placesMap.containerPointToLatLng([size.x, bottom]);
  var c = placesMap.containerPointToLatLng([size.x / 2, bottom / 2]);
  placesView = { n: nw.lat, w: nw.lng, s: se.lat, e: se.lng, center: { lat: c.lat, lng: c.lng } };
}

/* Once the map stops: redraw the list for the new view, and (a moment
   later, if it's still there) ask the map's data about gyms around it. */
function mapSettled() {
  updateView();
  renderPlacesList();
  drawSuggestionPins();
  clearTimeout(nearbyTimer);
  nearbyTimer = setTimeout(function () {
    if (currentTab !== "gyms" || !placesView || !canAskNearby(placesView)) return;
    var view = placesView;
    nearbyBusy = true;
    lookUpNearby(view).then(function (asked) {
      nearbyBusy = false;
      if (currentTab !== "gyms") return;
      if (asked) { renderPlacesList(); drawSuggestionPins(); }
    }, function () { nearbyBusy = false; });
  }, 700);
}

var suggestPins = null;
function drawSuggestionPins() {
  if (!placesMap || !Leaflet) return;
  if (!suggestPins) suggestPins = Leaflet.layerGroup().addTo(placesMap);
  suggestPins.clearLayers();
  suggestions().forEach(function (s) {
    var m = Leaflet.marker([s.place.lat, s.place.lng], {
      icon: pinIcon("is-osm"), title: s.place.name, alt: s.place.name, zIndexOffset: -100
    });
    m.on("click", function () { openSuggestion(s.place); });
    m.addTo(suggestPins);
  });
}

function drawPlacesMap(rows) {
  var box = document.getElementById("places-map");
  var note = document.getElementById("places-map-note");
  loadLeaflet().then(function (L) {
    if (currentTab !== "gyms") return;
    var first = !placesMap;
    if (first) {
      box.innerHTML = "";
      // full screen, so one finger moves the map, like every maps app
      placesMap = L.map(box, { zoomControl: false, attributionControl: false }).setView(NOWHERE, 3);
      L.control.attribution({ position: "topleft", prefix: false }).addTo(placesMap);
      if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) {
        L.control.zoom({ position: "topright" }).addTo(placesMap);
      }
      addTiles(placesMap);
      placesPins = L.layerGroup().addTo(placesMap);
      placesMap.on("dragstart zoomstart", function (e) { if (e.type === "dragstart") placesTouched = true; });
      placesMap.on("moveend", mapSettled);
      // dragging the map tucks the sheet down, so you can see where you're going
      placesMap.on("dragstart", function () { if (sheetSnap === "full") placeSheet("half"); });
    }
    placesMap.invalidateSize();
    placeSheet(null, first ? false : undefined);
    placesPins.clearLayers();

    var pts = [];
    rows.forEach(function (r) {
      if (r.gym.lat == null) return;
      var m = L.marker([r.gym.lat, r.gym.lng], {
        icon: pinIcon(pinKind(r)), title: gymLabel(r.gym), alt: gymLabel(r.gym),
        zIndexOffset: r.home ? 500 : r.friends.length ? 200 : 0
      });
      m.on("click", function () { openGymModal(r.gym.id); });
      m.addTo(placesPins);
      pts.push({ at: [r.gym.lat, r.gym.lng], km: r.km });
    });
    if (placesLoc) {
      L.circleMarker([placesLoc.lat, placesLoc.lng], {
        radius: 7, weight: 3, className: "you-dot", interactive: false
      }).addTo(placesPins);
    }

    note.hidden = pts.length > 0 || !!placesLoc;
    if (!pts.length) {
      note.textContent = rows.length ? "These gyms aren’t on the map yet." : "No gyms on the map yet.";
    }

    // Frame the pins again when what you asked for changes. When pins just
    // trickle in, only reframe if you haven't moved the map yourself.
    var fit = placesQuery.trim().toLowerCase() + "|" + (placesLoc ? "near" : "");
    var pinKey = pts.map(function (p) { return p.at.join(","); }).join(";");
    var asked = fit !== placesFit;
    if (asked) placesTouched = false;
    if (asked || (pinKey !== placesPinKey && !placesTouched)) {
      // keep what's framed above the sheet, not under it
      var pad = { paddingTopLeft: [36, 50], paddingBottomRight: [36, sheetShown() + 24], maxZoom: 15, animate: false };
      var frame = pts.map(function (p) { return p.at; });
      if (placesLoc && !placesQuery.trim()) {
        // you, and the closest few gyms within a short drive
        frame = pts.filter(function (p) { return p.km != null && p.km < 8; }).slice(0, 5).map(function (p) { return p.at; });
        frame.push([placesLoc.lat, placesLoc.lng]);
      }
      if (frame.length === 1) {
        placesMap.setView(frame[0], 14, { animate: false });
        placesMap.panBy([0, sheetShown() / 2], { animate: false });
      } else if (frame.length) placesMap.fitBounds(frame, pad);
      else placesMap.setView(NOWHERE, 3, { animate: false });
    }
    placesFit = fit;
    placesPinKey = pinKey;
    mapSettled();
  }).catch(function () {
    if (!placesMap) box.innerHTML = MAP_OFF_HTML;
  });
}

/* "Near me": asked for only when you tap it. Your position sorts the list
   and frames the map, and is forgotten when the app closes; that you
   chose it is remembered, so the tab finds you again next time. */
function locateMe(quiet) {
  var near = document.getElementById("places-near");
  if (!navigator.geolocation) { if (!quiet) showToast("This device can’t share its location."); return; }
  placesLocating = true;
  near.disabled = true;
  renderPlacesList();
  navigator.geolocation.getCurrentPosition(function (pos) {
    placesLocating = false;
    near.disabled = false;
    near.classList.add("is-on");
    near.setAttribute("aria-pressed", "true");
    placesLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (!state.settings.nearMe) { state.settings.nearMe = true; persist(); }
    renderPlaces();
  }, function (err) {
    placesLocating = false;
    near.disabled = false;
    if (err && err.code === 1 && state.settings.nearMe) { delete state.settings.nearMe; persist(); }
    renderPlacesList();
    if (!quiet || (err && err.code === 1)) {
      showToast(err && err.code === 1
        ? "Location is off for GymSocial. Turn it on in your phone’s settings."
        : "Couldn’t find where you are. Try again.");
    }
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

function forgetMe() {
  var near = document.getElementById("places-near");
  placesLoc = null;
  near.classList.remove("is-on");
  near.setAttribute("aria-pressed", "false");
  if (state.settings.nearMe) { delete state.settings.nearMe; persist(); }
  renderPlaces();
}

/* ---- a gym from the map's data ---- */

function openSuggestion(p) {
  var km = distanceKm(placesLoc || (placesView && placesView.center) || p, p);
  var addr = [p.street, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  var maps = "https://maps.apple.com/?q=" + encodeURIComponent(p.name) + "&ll=" + p.lat + "," + p.lng;
  var el = openListSheet("Gym", '<div class="osm-gym">' +
      '<span class="place-pin is-osm is-big">' + PIN_SVG + '</span>' +
      '<div class="profile-name">' + esc(p.name) + '</div>' +
      (addr ? '<div class="profile-handle">' + esc(addr) + '</div>' : '') +
      (placesLoc ? '<div class="osm-km">' + esc(formatDistance(km)) + ' away</div>' : '') +
      '<p class="osm-note">Nobody has added this gym to GymSocial yet. Add it and it&rsquo;s on the map for everyone, ' +
        'ready to check in to.</p>' +
      '<button class="btn btn-primary btn-block" id="osm-add">Add to GymSocial</button>' +
      '<a class="btn btn-ghost btn-block" id="osm-maps" href="' + esc(maps) + '" target="_blank" rel="noopener">Directions</a>' +
      '<p class="osm-source">From OpenStreetMap</p>' +
    '</div>');
  el.querySelector("#osm-add").addEventListener("click", function (e) {
    e.currentTarget.disabled = true;
    addSuggestion(p).then(function (g) {
      closeListSheet();
      renderPlaces();
      openGymModal(g.id);
      showToast("Added " + gymLabel(g) + ".");
    });
  });
}

/* One gym, one place: if it's already on GymSocial under another spelling,
   that one is used. Otherwise it's added with the map's pin, so it never
   needs an address lookup; only a missing town is filled in. */
function addSuggestion(p) {
  var needTown = !p.city ? placeOf(p.lat, p.lng) : Promise.resolve(null);
  return needTown.then(function (town) {
    var fields = { name: p.name, street: p.street || "", city: p.city || (town && town.city) || "", state: p.state || (town && town.state) || "" };
    var match = closestGym(fields, allKnownGyms().filter(function (x) { return x.mine || !x.private; }));
    if (match && (match.exact || (match.gym.lat != null && distanceKm(match.gym, p) < 0.4))) {
      var mine = adoptGym(match.gym);
      persist();
      return mine;
    }
    var fresh = { id: uid("gym"), name: fields.name, street: fields.street, city: fields.city, state: fields.state,
                  offerings: [], lat: p.lat, lng: p.lng, locDirty: true };
    state.gyms.push(fresh);
    persist();
    return fresh;
  });
}

/* ----------------------------- find a gym (when logging) ----------------------------- */

/* Searches every gym the app knows -- yours, your friends', and everyone
   else's -- so the same place doesn't get added twice under two spellings.
   "Add a new gym" is still there, at the bottom, for one that's truly new. */
export function openGymFinder(onPick) {
  var q = "";
  var el = openListSheet("Find your gym",
    '<div class="find-box">' +
      '<svg class="find-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>' +
      '<input type="search" id="finder-search" placeholder="Gym name or city" autocomplete="off" ' +
        'autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Search gyms">' +
    '</div>' +
    '<div id="finder-results"></div>' +
    '<button class="btn btn-ghost btn-block" id="finder-add">+ Add a new gym</button>');
  var results = el.querySelector("#finder-results");
  var addBtn = el.querySelector("#finder-add");

  var draw = function () {
    var needle = q.trim().toLowerCase();
    var list = allKnownGyms().filter(function (g) {
      return !needle || (g.name + " " + gymAddress(g)).toLowerCase().indexOf(needle) !== -1;
    }).sort(function (a, b) {
      return (b.mine - a.mine) || ((b.people || 0) - (a.people || 0)) || a.name.localeCompare(b.name);
    });
    results.innerHTML = list.length
      ? list.slice(0, 40).map(function (g) {
          var sub = [gymAddress(g),
            g.people ? g.people + (g.people === 1 ? " person" : " people") + " this month" : null]
            .filter(Boolean).map(esc).join(" &middot; ");
          return '<button class="place-row" data-finder="' + esc(g.id) + '">' +
            '<span class="place-pin ' + (g.mine ? "is-yours" : "") + '">' + PIN_SVG + '</span>' +
            '<span class="person-body">' +
              '<span class="person-name">' + esc(gymLabel(g)) +
                (g.mine ? '<span class="place-tag is-muted">On your list</span>' : '') + '</span>' +
              (sub ? '<span class="person-sub">' + sub + '</span>' : '') +
            '</span><span class="chevron">&rsaquo;</span></button>';
        }).join("")
      : '<div class="empty-state">' + (needle
          ? 'No gym matches “' + esc(q.trim()) + '” yet.'
          : "No gyms yet. Add the one you train at.") + '</div>';
    addBtn.textContent = needle ? '+ Add “' + titleCase(q) + '” as a new gym' : "+ Add a new gym";
    results.querySelectorAll("[data-finder]").forEach(function (row) {
      row.addEventListener("click", function () {
        var g = knownGym(row.getAttribute("data-finder"));
        if (!g) return;
        var mine = adoptGym(g);
        persist();
        closeListSheet();
        onPick(mine, false);
      });
    });
  };
  draw();

  el.querySelector("#finder-search").addEventListener("input", function (e) {
    q = e.target.value;
    draw();
  });
  addBtn.addEventListener("click", function () {
    closeListSheet();
    openGymAdd(onPick, null, titleCase(q));
  });
  refreshDirectory(true).then(function () {
    if (document.body.contains(results) &&
        document.getElementById("list-modal-overlay").classList.contains("open")) draw();
  });
}

/* ----------------------------- a gym's page ----------------------------- */

var openGymId = null;
var gymMoving = false;          // the pin is being dragged
var gymStats = {};              // gym id -> totals from the database, kept for this session
var gymMap = null;
var gymMapPin = null;

function gymModalIsOpen() {
  return document.getElementById("gym-modal-overlay").classList.contains("open");
}

function destroyGymMap() {
  if (gymMap) { gymMap.remove(); gymMap = null; gymMapPin = null; }
}

function closeGymModal() {
  document.getElementById("gym-modal-overlay").classList.remove("open");
  destroyGymMap();
  gymMoving = false;
  openGymId = null;
}

function hourLabel(h) {
  return (h % 12 || 12) + (h < 12 ? " AM" : " PM");
}

/* "Maya, Dev" -- first names, and a count once the line would run long. */
function firstNames(users) {
  var names = users.slice(0, 3).map(function (u) { return String(u.name || "").split(" ")[0]; });
  return names.join(", ") + (users.length > 3 ? " +" + (users.length - 3) : "");
}

export function openGymModal(gymId) {
  var g = knownGym(gymId);
  if (!g) return;
  openGymId = gymId;
  gymMoving = false;
  drawGymPage();
  document.getElementById("gym-modal-overlay").classList.add("open");

  // Everyone's totals come from the database and never include a name.
  if (currentUser()) {
    fetchGymStats(gymId).then(function (stats) {
      if (!stats) return;
      gymStats[gymId] = stats;
      if (openGymId === gymId && gymModalIsOpen() && !gymMoving) drawGymPage();
    }).catch(function () { /* offline: the page still shows what this phone knows */ });
  }
  lookUpPin(gymId).then(function () {
    if (openGymId === gymId && gymModalIsOpen() && !gymMoving) drawGymPage();
  });
}

function drawGymPage() {
  var gymId = openGymId;
  var g = knownGym(gymId);
  if (!g) return;
  var overlay = document.getElementById("gym-modal-overlay");
  overlay.querySelector("#gym-modal-name").textContent = g.name;
  overlay.querySelector("#gym-modal-city").textContent = gymAddress(g);
  document.getElementById("gym-modal-edit").hidden = !g.mine || gymMoving;

  var body = overlay.querySelector("#gym-modal-body");
  var stats = gymStats[gymId] || null;
  var isHome = state.settings.homeGymId === gymId;
  var html = "";

  // ---- where it is ----
  if (gymMoving) {
    html += '<div class="gym-map is-moving" id="gym-map"></div>' +
      '<p class="gym-map-help">Drag the pin, or tap the map, to put it in the right spot.</p>' +
      '<div class="gym-actions">' +
        '<button class="btn btn-primary" id="gym-pin-save">Save pin</button>' +
        '<button class="btn btn-ghost" id="gym-pin-cancel">Cancel</button>' +
      '</div>';
  } else if (g.lat != null) {
    html += '<div class="gym-map" id="gym-map"></div>' +
      '<button class="text-link gym-pin-link" id="gym-pin-move">Pin in the wrong spot? Move it</button>';
  } else if (g.private) {
    html += '<p class="gym-nomap">Private gym. It stays off the map and out of other people’s search.</p>';
  } else {
    html += '<p class="gym-nomap">' +
      (pinLookups[gymId] === "busy" ? "Finding this address on the map…" : "Not on the map yet.") +
      ' <button class="text-link" id="gym-pin-move">Place the pin yourself</button></p>';
  }

  if (!gymMoving) {
    // ---- you ----
    var sessions = myWorkouts().filter(function (w) { return w.gymId === gymId; })
      .sort(function (a, b) { return new Date(b.performedAt) - new Date(a.performedAt); });
    if (sessions.length) {
      html += '<div class="stat-grid gym-you">' +
        '<div class="stat-tile"><span class="num">' + sessions.length + '</span><span class="label">' +
          (sessions.length === 1 ? "Your session" : "Your sessions") + '</span></div>' +
        '<div class="stat-tile"><span class="num">' + esc(calendarDate(sessions[0].performedAt).split(",")[1].trim()) +
          '</span><span class="label">Last visit</span></div>' +
      '</div>';
      html += visitBadgesHtml(sessions.length);
    }

    // ---- who's here right now (friends who chose to share it) ----
    var hereNow = liveFriends().filter(function (l) { return l.gymId === gymId; });
    if (hereNow.length) {
      html += '<div class="manage-head"><span class="live-dot"></span>Here now</div>' +
        hereNow.map(function (l) {
          return '<div class="gym-here" data-profile="' + esc(l.user.id) + '">' + avatarHtml(l.user) +
            '<span class="gym-friends-text">' + esc(l.user.name) + '</span>' +
            '<span class="gym-here-when">' + esc(sinceShort(l.at)) + '</span></div>';
        }).join("");
    }

    // ---- regulars: you and your friends, this month ----
    html += regularsHtml(gymId);

    // ---- friends, by name ----
    var friends = friendsAtGyms()[gymId];
    if (friends && friends.users.length) {
      html += '<div class="manage-head">Friends who train here</div>' +
        '<div class="gym-friends">' +
          '<span class="avatar-stack is-big">' + friends.users.slice(0, 5).map(function (u) {
            return '<span class="profile-tap" data-profile="' + esc(u.id) + '">' + avatarHtml(u) + '</span>';
          }).join("") + '</span>' +
          '<span class="gym-friends-text">' + esc(firstNames(friends.users)) +
            (friends.today.length
              ? ' <span class="gym-today">&middot; ' + friends.today.length + ' today</span>' : '') +
          '</span>' +
        '</div>';
    }

    // ---- everyone else, as totals only ----
    if (stats) {
      if (stats.people) {
        html += '<p class="gym-people"><strong>' + stats.people + '</strong> ' +
          (stats.people === 1 ? "person" : "people") + ' trained here in the last 30 days</p>';
      }
      html += '<div class="manage-head">Popular here <span class="head-note">last 30 days</span></div>';
      html += stats.top.length
        ? stats.top.slice(0, 6).map(function (t, i) {
            return '<div class="popular-row"><span class="popular-rank">' + (i + 1) + '</span>' +
              '<div class="popular-name">' + esc(t.name) + '</div>' +
              '<div class="popular-count num">' + Number(t.sets) + (Number(t.sets) === 1 ? ' set' : ' sets') + '</div></div>';
          }).join("")
        : '<div class="empty-state gym-empty">Nothing logged here in the last 30 days.</div>';

      var busiest = Math.max.apply(null, stats.byHour.concat([0]));
      if (busiest > 0) {
        var peak = stats.byHour.indexOf(busiest);
        html += '<div class="manage-head">Busiest <span class="head-note">around ' + hourLabel(peak) + '</span></div>' +
          '<div class="hours" role="img" aria-label="Workouts by hour of day over the last 90 days. Busiest around ' +
            hourLabel(peak) + '.">' +
            stats.byHour.map(function (n, h) {
              return '<span class="hour' + (h === peak ? " is-peak" : "") + '" style="height:' +
                (n ? Math.max(10, Math.round(n / busiest * 100)) : 3) + '%"></span>';
            }).join("") +
          '</div>' +
          '<div class="hours-axis" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span></div>';
      }
    } else {
      // signed out, or the database can't count yet: what you train here
      var breakdown = gymExerciseBreakdown(gymId);
      html += '<div class="manage-head">What you train here</div>';
      html += breakdown.length
        ? breakdown.slice(0, 6).map(function (p, i) {
            return '<div class="popular-row"><span class="popular-rank">' + (i + 1) + '</span>' +
              '<div class="popular-name">' + esc(p.name) + '</div>' +
              '<div class="popular-count num">' + p.count + (p.count === 1 ? ' session' : ' sessions') + '</div></div>';
          }).join("")
        : '<div class="empty-state gym-empty">Nothing logged here yet.</div>';
    }

    html += '<div class="gym-actions">' +
      '<button class="btn btn-primary" id="gym-checkin">Check in here</button>' +
      '<button class="btn btn-ghost' + (isHome ? " is-on" : "") + '" id="gym-home" aria-pressed="' + (isHome ? "true" : "false") + '">' +
        (isHome ? "✓ My gym" : "Set as my gym") + '</button>' +
    '</div>';
  }

  destroyGymMap();
  body.innerHTML = html;

  var on = function (id, fn) {
    var b = body.querySelector("#" + id);
    if (b) b.addEventListener("click", fn);
  };
  on("gym-pin-move", function () { gymMoving = true; drawGymPage(); });
  on("gym-pin-cancel", function () { gymMoving = false; drawGymPage(); });
  on("gym-pin-save", saveMovedPin);
  on("gym-checkin", function () { checkInAt(gymId); });
  on("gym-home", function () { toggleHomeGym(gymId); });

  var box = body.querySelector("#gym-map");
  if (!box) return;
  var moving = gymMoving;
  loadLeaflet().then(function (L) {
    if (openGymId !== gymId || !document.body.contains(box) || gymMap) return;
    var hasPin = g.lat != null;
    var start = hasPin ? [g.lat, g.lng]
      : placesLoc ? [placesLoc.lat, placesLoc.lng]
      : placesMap ? [placesMap.getCenter().lat, placesMap.getCenter().lng] : NOWHERE;
    var zoom = hasPin ? 15 : placesLoc ? 14 : placesMap ? placesMap.getZoom() : 3;
    // still until you ask to move the pin, so scrolling the page never drags the map
    gymMap = L.map(box, {
      zoomControl: moving, dragging: moving, touchZoom: moving, scrollWheelZoom: moving,
      doubleClickZoom: moving, boxZoom: false, keyboard: moving
    }).setView(start, zoom);
    addTiles(gymMap);
    gymMapPin = L.marker(start, { icon: pinIcon("is-home"), draggable: moving, keyboard: false, interactive: moving })
      .addTo(gymMap);
    if (moving) gymMap.on("click", function (e) { gymMapPin.setLatLng(e.latlng); });
    setTimeout(function () { if (gymMap) gymMap.invalidateSize(); }, 220);   // after the sheet slides up
  }).catch(function () {
    box.innerHTML = MAP_OFF_HTML;
  });
}

/* ---- regulars and crowns ----
   A monthly board for each gym, among you and your friends only -- the
   same people whose workouts you can already see. Most sessions this
   calendar month wears the crown; a tie shares it. */
export var CROWN_SVG = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M3.2 8.2 7.6 12 12 5l4.4 7 4.4-3.8-1.7 9.6H4.9z"/></svg>';
var VISIT_BADGES = [5, 10, 25, 50, 100, 250, 500];

function gymRegulars(gymId) {
  var now = new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  var rows = [{ user: state.me, isMe: true }].concat(friendsOf(state.me.id).map(function (u) {
    return { user: u, isMe: false };
  })).map(function (r) {
    r.n = workoutsOf(r.user.id).filter(function (w) {
      return w.gymId === gymId && new Date(w.performedAt).getTime() >= monthStart;
    }).length;
    return r;
  }).filter(function (r) { return r.n > 0; });
  rows.sort(function (a, b) {
    return (b.n - a.n) || (b.isMe - a.isMe) || String(a.user.name).localeCompare(String(b.user.name));
  });
  rows.forEach(function (r, i) {
    // equal sessions, equal rank
    r.rank = i && rows[i - 1].n === r.n ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

function regularsHtml(gymId) {
  if (!friendsOf(state.me.id).length) return "";      // a board of one isn't a board
  var rows = gymRegulars(gymId);
  if (!rows.length) return "";
  return '<div class="manage-head">Regulars <span class="head-note">' +
      MONTHS_LONG[new Date().getMonth()] + ', you and friends</span></div>' +
    rows.slice(0, 8).map(function (r) {
      return '<div class="regular' + (r.isMe ? " is-me" : "") + '"' +
          (r.isMe ? '' : ' data-profile="' + esc(r.user.id) + '"') + '>' +
        '<span class="regular-rank">' + (r.rank === 1 ? CROWN_SVG + '<span class="sr-only">First place</span>' : r.rank) + '</span>' +
        avatarHtml(r.user) +
        '<span class="regular-name">' + esc(r.isMe ? "You" : r.user.name) + '</span>' +
        '<span class="regular-n num">' + r.n + (r.n === 1 ? " session" : " sessions") + '</span>' +
      '</div>';
    }).join("");
}

/* Visit badges are yours alone: the app has your whole history but only
   the last few months of a friend's, so theirs couldn't be counted fairly. */
function visitBadgesHtml(visits) {
  var earned = VISIT_BADGES.filter(function (n) { return visits >= n; });
  var next = VISIT_BADGES.filter(function (n) { return visits < n; })[0];
  if (!earned.length && !next) return "";
  return '<div class="badges">' +
    earned.slice(-3).map(function (n) {
      return '<span class="badge is-earned">' + n + ' visits</span>';
    }).join("") +
    (next ? '<span class="badge">' + next + ' visits <span class="badge-togo">' + (next - visits) + ' to go</span></span>' : '') +
  '</div>';
}

function saveMovedPin() {
  var id = openGymId;
  var g = knownGym(id);
  if (!g || !gymMapPin) return;
  var at = gymMapPin.getLatLng();
  var before = g.lat != null ? [g.lat, g.lng] : [null, null];
  gymMoving = false;
  var mine = setGymPinLocal(id, at.lat, at.lng);
  pinLookups[id] = "done";
  if (mine || !currentUser()) {
    showToast("Pin saved.");                 // yours: goes up with the next sync
  } else {
    saveGymLocation(id, at.lat, at.lng).then(function () {
      showToast("Pin saved.");
    }, function (err) {
      // the database decides who may move a pin; put it back if it said no
      setGymPinLocal(id, before[0], before[1]);
      showToast((err && err.message) || "Couldn’t save the pin.");
      if (openGymId === id && gymModalIsOpen()) drawGymPage();
      if (currentTab === "gyms") renderPlaces();
    });
  }
  drawGymPage();
  if (currentTab === "gyms") renderPlaces();
}

/* Starts (or carries on) a workout checked in at this gym. */
function checkInAt(gymId) {
  var g = knownGym(gymId);
  if (!g) return;
  var mine = adoptGym(g);
  persist();
  closeGymModal();
  if (!draftHasContent(draft)) resetDraft();      // a clean form, dated now
  draft.gymId = mine.id;
  startLive(mine.id);
  activateTab("log");
  showToast("Checked in at " + gymLabel(mine) + ".");
}

/* "My gym" is the one a new workout starts checked in to. */
function toggleHomeGym(gymId) {
  var g = knownGym(gymId);
  if (!g) return;
  if (state.settings.homeGymId === gymId) {
    delete state.settings.homeGymId;
    showToast("No longer your gym.");
  } else {
    adoptGym(g);
    state.settings.homeGymId = gymId;
    if (!draftHasContent(draft)) draft.gymId = gymId;
    showToast(gymLabel(g) + " is your gym. New workouts start checked in here.");
  }
  persist();
  drawGymPage();
  if (currentTab === "gyms") renderPlaces();
}

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls this in a fixed order. */

export function startGyms() {
  document.getElementById("gym-search").addEventListener("input", renderGyms);
  document.getElementById("gyms-add-btn").addEventListener("click", function () {
    openGymFinder(function (g) {
      renderGyms();
      showToast("Added " + gymLabel(g) + ".");
    });
  });
  (function wireGymAdd() {
    var f = gymAddFields();
    [f.name, f.street, f.city, f.state].forEach(function (input) {
      input.addEventListener("input", updateGymAddPreview);
    });
    f.isPrivate.addEventListener("change", updateGymAddPreview);
    // Letters only, two of them. maxlength would let a stray digit eat a
    // slot, so the trimming happens after the junk is thrown away.
    f.state.addEventListener("input", function (e) {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    });

    document.getElementById("gym-add-close").addEventListener("click", closeGymAdd);
    document.getElementById("gym-add-overlay").addEventListener("click", function (e) {
      if (e.target.id === "gym-add-overlay") closeGymAdd();
    });

    document.getElementById("gym-add-save").addEventListener("click", function () {
      var fields = {
        name: titleCase(f.name.value),
        street: titleCase(f.street.value),
        city: titleCase(f.city.value),
        state: f.state.value.trim().toUpperCase()
      };
      if (!fields.name) { showToast("Give the gym a name."); f.name.focus(); return; }

      var key = gymKey(fields);
      var clash = state.gyms.some(function (x) {
        return x !== gymEditing && gymKey(x) === key;
      });
      if (clash) { showToast("You already have that one."); return; }

      var isPrivate = f.isPrivate.checked;
      // held here: closing the sheet forgets who was waiting on it
      var done = gymAddDone;
      var finish = function (gym, wasEdit) {
        persist();
        closeGymAdd();
        if (done) done(gym, wasEdit);
      };

      var g = gymEditing;
      if (g) {
        var moved = g.street !== fields.street || g.city !== fields.city ||
          g.state !== fields.state || g.name !== fields.name;
        // edited in place, so every workout already checked in here follows
        g.name = fields.name;
        g.street = fields.street;
        g.city = fields.city;
        g.state = fields.state;
        if (isPrivate || g.private !== undefined) g.private = isPrivate;
        if (moved) {
          // a new address needs a new pin; the old one would point at the old place
          setGymPinLocal(g.id, null, null);
          delete pinLookups[g.id];
        }
        finish(g, true);
        lookUpPin(g.id);
        return;
      }

      var create = function () {
        var fresh = { id: uid("gym"), name: fields.name, street: fields.street,
                      city: fields.city, state: fields.state, offerings: [] };
        if (isPrivate) fresh.private = true;
        state.gyms.push(fresh);
        finish(fresh, false);
        lookUpPin(fresh.id);
      };

      /* One gym, one place. If this gym is already known -- on your own list
         under another spelling, or added by someone else -- using that one
         is what puts you on the same page as everyone who trains there, so
         the closest match is offered before a new one is made.
         A private gym is yours alone and skips the question. */
      var match = isPrivate ? null : closestGym(fields, allKnownGyms().filter(function (x) {
        return x.mine || !x.private;
      }));
      if (!match) { create(); return; }
      var useTheirs = function () { finish(adoptGym(match.gym), false); };
      if (match.exact) { useTheirs(); return; }
      var where = gymAddress(match.gym);
      openConfirm({
        title: "Is this the same gym?",
        body: gymLabel(match.gym) + (where ? " (" + where + ")" : "") +
          (match.gym.mine
            ? " is already on your list."
            : " is already on GymSocial. Using it keeps everyone who trains there together."),
        confirmLabel: "Yes, use it",
        cancelLabel: "No, add mine",
        danger: false,
        onConfirm: useTheirs,
        onCancel: create
      });
    });

    document.getElementById("gym-add-remove").addEventListener("click", function () {
      var g = gymEditing;
      if (!g) return;
      var n = myWorkouts().filter(function (w) { return w.gymId === g.id; }).length;
      openConfirm({
        title: "Remove " + g.name + "?",
        body: n
          ? n + (n === 1 ? " session loses its check-in" : " sessions lose their check-in") +
            ". The sessions themselves are kept."
          : "Nothing is checked in here yet.",
        confirmLabel: "Remove gym",
        onConfirm: function () {
          myWorkouts().forEach(function (w) { if (w.gymId === g.id) w.gymId = null; });
          state.gyms = state.gyms.filter(function (x) { return x.id !== g.id; });
          if (draft.gymId === g.id) draft.gymId = "";
          if (editDraft && editDraft.gymId === g.id) editDraft.gymId = "";
          if (state.settings.homeGymId === g.id) delete state.settings.homeGymId;
          persist();
          closeGymAdd();
          closeGymModal();
          renderGyms();
          renderLog();
          renderHome();
          if (currentTab === "gyms") renderPlaces();
          showToast("Removed " + g.name + ".");
        }
      });
    });
  })();
  document.getElementById("gym-modal-edit").addEventListener("click", function () {
    var id = openGymId;
    // only a gym on your own list can be edited
    var g = state.gyms.filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    openGymAdd(function (saved) {
      renderGyms();
      renderLog();
      renderHome();
      if (currentTab === "gyms") renderPlaces();
      openGymModal(saved.id);          // reopen with the new details
      showToast("Updated " + gymLabel(saved) + ".");
    }, g);
  });
  (function wirePlaces() {
    var input = document.getElementById("places-search");
    var clear = document.getElementById("places-clear");
    // Filters the gyms already known to the app. It never calls the address
    // lookup: that service doesn't allow search-as-you-type.
    input.addEventListener("input", function () {
      placesQuery = input.value;
      clear.hidden = !input.value;
      renderPlaces();
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") input.blur(); });
    clear.addEventListener("click", function () {
      input.value = "";
      input.dispatchEvent(new Event("input"));
    });

    var near = document.getElementById("places-near");
    near.addEventListener("click", function () { if (placesLoc) forgetMe(); else locateMe(false); });
    // searching wants the room: the sheet comes all the way up
    input.addEventListener("focus", function () { placeSheet("full"); });
    wireSheet();
  })();
  document.getElementById("gym-modal-close").addEventListener("click", closeGymModal);
  document.getElementById("gym-modal-overlay").addEventListener("click", function (e) {
    if (e.target.id === "gym-modal-overlay") closeGymModal();
  });
}
