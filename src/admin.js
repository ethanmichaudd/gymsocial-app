/**
 * The developer page (admin.html).
 *
 * A separate page from the app, for one kind of account: a developer
 * account. It shows how many people use the app, lets you fix usernames and
 * gyms, and switches address lookups on or off.
 *
 * What protects it is the database, not this file. Every button calls an
 * admin_* function from supabase/010_admin.sql, and each of those checks
 * that the caller is on the admins list before doing anything. Someone who
 * opens this page without a developer account sees a sign-in form and
 * nothing else.
 *
 * Privacy: those functions return a username, a display name, when the
 * person joined and was last active, and a workout count. No email, no
 * workouts, no photos, no comments. Private gyms are only a number.
 *
 * It keeps its own sign-in, separate from the app's and gone when the tab
 * closes, so using this page never signs the app on this device in or out.
 */
import "./admin.css";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_DOMAIN } from "./config.js";

var USERNAME_RULE = /^[a-z0-9_.]{3,20}$/;
var PAGE = 50;                       // people per "Show more"

var tabStorage = null;
try { tabStorage = window.sessionStorage; } catch (e) { /* blocked: stay signed in for this page load only */ }

var db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: Boolean(tabStorage),
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "gymsocial-admin-auth",
    storage: tabStorage || undefined,
  },
});

var me = null;                       // { id, username } once signed in
var authMode = "signin";
var people = [];
var peopleDone = false;
var gyms = [];
var overview = null;
var openEditor = null;               // "user:<id>" | "gym:<id>:edit" | "gym:<id>:merge"
var toastTimer = null;
var searchTimer = null;

/* ------------------------------ helpers ------------------------------ */

function $(id) { return document.getElementById(id); }

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function toast(text) {
  var el = $("adm-toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
}

function show(which) {
  ["adm-loading", "adm-auth", "adm-blocked", "adm-main"].forEach(function (id) { $(id).hidden = id !== which; });
  $("adm-who").hidden = !me;
  $("adm-who-name").textContent = me ? "@" + me.username : "";
}

function loginEmail(name) {
  var v = String(name || "").trim().toLowerCase().replace(/^@/, "");
  return v.indexOf("@") !== -1 ? v : v + "@" + LOGIN_DOMAIN;
}

function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

function dayText(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function agoText(iso) {
  if (!iso) return "never";
  var ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "never";
  var min = Math.max(0, Math.round(ms / 60000));
  if (min < 2) return "just now";
  if (min < 60) return min + " min ago";
  var hr = Math.round(min / 60);
  if (hr < 24) return plural(hr, "hour") + " ago";
  var days = Math.round(hr / 24);
  if (days < 30) return plural(days, "day") + " ago";
  return dayText(iso);
}

/** Calls one database function. Resolves with its result, rejects with a readable message. */
function call(fn, args) {
  return Promise.resolve(db.rpc(fn, args || {})).then(function (res) {
    if (!res.error) return res.data;
    var err = res.error;
    var out = new Error(err.message || "That didn't work.");
    out.missing = err.code === "PGRST202";
    out.denied = err.code === "42501" || /Developer account only/.test(err.message || "");
    throw out;
  });
}

/* ------------------------------ sign in ------------------------------ */

function setAuthMode(mode) {
  authMode = mode;
  var up = mode === "signup";
  $("adm-auth-title").textContent = up ? "Create the developer account" : "Developer sign in";
  $("adm-auth-sub").textContent = up
    ? "Pick a username nobody would mistake for a person, like gymsocial_dev. After this, one line in Supabase turns it into a developer account."
    : "For the developer account only. It can't log workouts or be found in the app.";
  $("adm-auth-go").textContent = up ? "Create account" : "Sign in";
  $("adm-auth-switch").textContent = up ? "Already have it? Sign in" : "First time? Create the developer account";
  $("adm-pass").setAttribute("autocomplete", up ? "new-password" : "current-password");
  $("adm-auth-note").textContent = "";
}

function submitAuth(ev) {
  ev.preventDefault();
  var name = $("adm-user").value.trim().toLowerCase().replace(/^@/, "");
  var pw = $("adm-pass").value;
  var note = $("adm-auth-note");
  if (!name || !pw) { note.textContent = "Enter the username and password."; return; }
  if (authMode === "signup") {
    if (!USERNAME_RULE.test(name)) { note.textContent = "Usernames are 3–20 lowercase letters, numbers, _ or ."; return; }
    if (pw.length < 10) { note.textContent = "Use at least 10 characters. This account can change other people's usernames."; return; }
  }
  var btn = $("adm-auth-go");
  btn.disabled = true;
  note.textContent = "";
  var creds = { email: loginEmail(name), password: pw };
  var job = authMode === "signup" ? db.auth.signUp(creds) : db.auth.signInWithPassword(creds);
  Promise.resolve(job).then(function (res) {
    btn.disabled = false;
    if (res.error) {
      var m = res.error.message || "";
      if (/invalid login/i.test(m)) note.textContent = "Wrong username or password.";
      else if (/already registered|already exists|database error/i.test(m)) note.textContent = "@" + name + " is taken. Try another.";
      else note.textContent = m || "That didn't work.";
      return;
    }
    if (!res.data || !res.data.session) { note.textContent = "Account created. Now sign in."; setAuthMode("signin"); return; }
    $("adm-pass").value = "";
    enter(res.data.session);
  }).catch(function (err) {
    btn.disabled = false;
    note.textContent = (err && err.message) || "No connection.";
  });
}

function signOut() {
  me = null;
  people = []; gyms = []; overview = null; openEditor = null;
  Promise.resolve(db.auth.signOut()).catch(function () {}).then(function () {
    setAuthMode("signin");
    show("adm-auth");
  });
}

/* Signed in. Ask the database whether this is a developer account. */
function enter(session) {
  var email = (session.user && session.user.email) || "";
  me = { id: session.user.id, username: email.split("@")[0] };
  show("adm-loading");
  call("is_admin").then(function (yes) {
    if (yes === true) { show("adm-main"); loadAll(); return; }
    blocked("not-developer");
  }).catch(function (err) {
    blocked(err.missing ? "no-migration" : "error", err.message);
  });
}

function blocked(why, detail) {
  var sql = $("adm-blocked-sql");
  var copy = $("adm-copy-sql");
  sql.hidden = true; copy.hidden = true;
  if (why === "no-migration") {
    $("adm-blocked-title").textContent = "One database step first";
    $("adm-blocked-text").textContent = "The developer tools aren't in the database yet. In Supabase, open the SQL editor, paste in supabase/010_admin.sql from the project, and run it. Then check again.";
  } else if (why === "not-developer") {
    $("adm-blocked-title").textContent = "@" + me.username + " isn't a developer account yet";
    $("adm-blocked-text").textContent = "Run this line in the Supabase SQL editor, then check again. Only someone who can open your Supabase project can do this.";
    sql.textContent = "insert into public.admins (user_id)\nselect id from public.profiles where username = '" + me.username.replace(/[^a-z0-9_.]/g, "") + "'\non conflict do nothing;";
    sql.hidden = false; copy.hidden = false;
  } else {
    $("adm-blocked-title").textContent = "Couldn't check this account";
    $("adm-blocked-text").textContent = detail || "No connection. Try again.";
  }
  show("adm-blocked");
}

/* An admin call can fail because the account stopped being a developer
   account, or the session ran out. Either way: back to the start. */
function fail(err) {
  if (err && err.denied) { toast("This account isn't a developer account."); blocked("not-developer"); return; }
  toast((err && err.message) || "That didn't work.");
}

/* ------------------------------ overview ------------------------------ */

function loadAll() {
  loadOverview();
  loadPeople(true);
  loadGyms();
}

function loadOverview() {
  return call("admin_overview").then(function (o) {
    overview = o || {};
    renderOverview();
  }).catch(fail);
}

function renderOverview() {
  var o = overview || {};
  var num = function (v) { return v == null ? "–" : Number(v).toLocaleString("en-US"); };
  var tiles = [
    [o.users, "accounts"],
    [o.signed_in, "signed in on a device"],
    [o.active_day, "active in the last day"],
    [o.active_week, "active in the last week"],
    [o.new_week, "joined this week"],
    [o.workouts, "workouts logged"],
    [o.workouts_week, "workouts this week"],
    [o.gyms, "gyms in the directory"],
    [o.gyms_no_pin, "gyms with no pin"],
    [o.gyms_private, "private gyms"],
  ];
  $("adm-tiles").innerHTML = tiles.map(function (t) {
    return '<div class="adm-tile"><b>' + esc(num(t[0])) + "</b><span>" + esc(t[1]) + "</span></div>";
  }).join("");
  $("adm-tiles-note").textContent = o.signed_in == null
    ? "Signed-in numbers aren't available from this database; “active” is counted from the last sign-in instead."
    : "“Signed in” means the account has a live session on at least one phone or browser. The developer account isn't counted.";
  $("adm-gyms-note").textContent = "Gyms anyone can find. " +
    (o.gyms_private ? plural(o.gyms_private, "private gym") + " (home gyms) " + (o.gyms_private === 1 ? "is" : "are") + " not listed here." : "Private gyms are never listed here.");
  var on = o.geocoding !== false;
  $("adm-geo-state").textContent = on ? "on" : "off";
  $("adm-geo-toggle").textContent = on ? "Turn off" : "Turn on";
}

function toggleGeocoding() {
  var on = !(overview && overview.geocoding === false);
  var btn = $("adm-geo-toggle");
  btn.disabled = true;
  call("admin_set_geocoding", { p_on: !on }).then(function (now) {
    btn.disabled = false;
    overview.geocoding = now !== false;
    renderOverview();
    toast(overview.geocoding ? "Address lookups are on." : "Address lookups are off.");
  }).catch(function (err) { btn.disabled = false; fail(err); });
}

/* ------------------------------ people ------------------------------ */

function loadPeople(fresh) {
  if (fresh) { people = []; peopleDone = false; }
  var term = $("adm-people-search").value.trim();
  return call("admin_users", { p_search: term, p_limit: PAGE, p_offset: people.length }).then(function (rows) {
    rows = rows || [];
    if ($("adm-people-search").value.trim() !== term) return;      // a newer search is on its way
    people = people.concat(rows);
    peopleDone = rows.length < PAGE;
    renderPeople();
  }).catch(fail);
}

function renderPeople() {
  var box = $("adm-people");
  if (!people.length) {
    box.innerHTML = '<p class="adm-empty">' + ($("adm-people-search").value.trim() ? "Nobody matches that." : "No accounts yet.") + "</p>";
  } else {
    box.innerHTML = people.map(function (p) {
      var editing = openEditor === "user:" + p.id;
      var meta = "Joined " + dayText(p.joined) + " · Active " + agoText(p.last_seen) + " · " + plural(p.workouts || 0, "workout");
      var html = '<div class="adm-item" data-user="' + esc(p.id) + '"><div class="adm-item-main">' +
        '<div class="adm-item-text"><div class="adm-item-title">' +
          (p.signed_in ? '<span class="adm-dot" title="Signed in"></span>' : "") +
          esc(p.display_name || p.username) + "<small>@" + esc(p.username) + "</small></div>" +
        '<div class="adm-item-meta">' + esc(meta) + "</div></div>" +
        '<div class="adm-item-actions"><button type="button" class="adm-btn small" data-act="rename">' + (editing ? "Close" : "Change username") + "</button></div></div>";
      if (editing) {
        html += '<form class="adm-edit" data-form="rename">' +
          '<label for="adm-new-name">New username for @' + esc(p.username) + "</label>" +
          '<input id="adm-new-name" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="21" value="' + esc(p.username) + '">' +
          '<p class="adm-hint">Their friends and workouts stay as they are. They stay signed in, and use the new username the next time they sign in, so let them know.</p>' +
          '<p class="adm-note" role="alert"></p>' +
          '<div class="adm-row-actions"><button type="submit" class="adm-btn primary">Save</button></div></form>';
      }
      return html + "</div>";
    }).join("");
  }
  $("adm-people-more").hidden = peopleDone || !people.length;
}

function saveUsername(item, form) {
  var id = item.getAttribute("data-user");
  var person = people.filter(function (p) { return p.id === id; })[0];
  var name = form.querySelector("input").value.trim().toLowerCase().replace(/^@/, "");
  var note = form.querySelector(".adm-note");
  if (!person) return;
  if (name === person.username) { openEditor = null; renderPeople(); return; }
  if (!USERNAME_RULE.test(name)) { note.textContent = "Usernames are 3–20 lowercase letters, numbers, _ or ."; return; }
  var btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  note.textContent = "";
  call("admin_set_username", { p_user: id, p_name: name }).then(function (saved) {
    var was = person.username;
    person.username = saved || name;
    openEditor = null;
    renderPeople();
    toast("@" + was + " is now @" + person.username + ".");
  }).catch(function (err) {
    btn.disabled = false;
    if (err.denied) { fail(err); return; }
    note.textContent = err.message;
  });
}

/* ------------------------------ gyms ------------------------------ */

function loadGyms() {
  return call("admin_gyms", { p_search: "" }).then(function (rows) {
    gyms = rows || [];
    renderGyms();
  }).catch(fail);
}

function gymAddress(g) {
  return [g.street, g.city, g.state].filter(Boolean).join(", ");
}

function shownGyms() {
  var term = $("adm-gyms-search").value.trim().toLowerCase();
  if (!term) return gyms;
  return gyms.filter(function (g) {
    return (g.name + " " + gymAddress(g)).toLowerCase().indexOf(term) !== -1;
  });
}

function renderGyms() {
  var box = $("adm-gyms");
  var list = shownGyms();
  if (!list.length) {
    box.innerHTML = '<p class="adm-empty">' + (gyms.length ? "No gym matches that." : "No gyms yet.") + "</p>";
    return;
  }
  box.innerHTML = list.map(function (g) {
    var hasPin = g.lat != null && g.lng != null;
    var meta = [gymAddress(g) || "No address", plural(g.sessions || 0, "workout"), plural(g.people || 0, "person", "people"), hasPin ? "" : "no pin"]
      .filter(Boolean).join(" · ");
    var editing = openEditor === "gym:" + g.id + ":edit";
    var merging = openEditor === "gym:" + g.id + ":merge";
    var html = '<div class="adm-item" data-gym="' + esc(g.id) + '"><div class="adm-item-main">' +
      '<div class="adm-item-text"><div class="adm-item-title">' + esc(g.name) + (g.hidden ? '<span class="adm-tag">Hidden</span>' : "") + "</div>" +
      '<div class="adm-item-meta">' + esc(meta) + "</div></div>" +
      '<div class="adm-item-actions">' +
        '<button type="button" class="adm-btn small" data-act="edit">' + (editing ? "Close" : "Edit") + "</button>" +
        '<button type="button" class="adm-btn small" data-act="merge">' + (merging ? "Close" : "Merge") + "</button>" +
        '<button type="button" class="adm-btn small" data-act="hide">' + (g.hidden ? "Show" : "Hide") + "</button>" +
      "</div></div>";
    if (editing) {
      html += '<form class="adm-edit" data-form="edit">' +
        '<label for="adm-g-name">Name</label><input id="adm-g-name" data-f="name" type="text" maxlength="80" value="' + esc(g.name) + '">' +
        '<label for="adm-g-street">Street</label><input id="adm-g-street" data-f="street" type="text" maxlength="120" value="' + esc(g.street) + '">' +
        '<div class="adm-grid">' +
          '<div><label for="adm-g-city">City</label><input id="adm-g-city" data-f="city" type="text" maxlength="60" value="' + esc(g.city) + '"></div>' +
          '<div><label for="adm-g-state">State</label><input id="adm-g-state" data-f="state" type="text" maxlength="30" value="' + esc(g.state) + '"></div>' +
          '<div><label for="adm-g-lat">Latitude</label><input id="adm-g-lat" data-f="lat" type="text" inputmode="decimal" placeholder="none" value="' + esc(hasPin ? g.lat : "") + '"></div>' +
          '<div><label for="adm-g-lng">Longitude</label><input id="adm-g-lng" data-f="lng" type="text" inputmode="decimal" placeholder="none" value="' + esc(hasPin ? g.lng : "") + '"></div>' +
        "</div>" +
        '<p class="adm-hint">Latitude and longitude are the pin. Clear both to remove it. In a maps app, press and hold on the building to see its coordinates.</p>' +
        '<p class="adm-note" role="alert"></p>' +
        '<div class="adm-row-actions"><button type="submit" class="adm-btn primary">Save</button></div></form>';
    }
    if (merging) {
      var others = gyms.filter(function (x) { return x.id !== g.id; });
      html += '<form class="adm-edit" data-form="merge">' +
        '<label for="adm-merge-into">This gym is a duplicate of</label>' +
        '<select id="adm-merge-into"><option value="">Choose the gym to keep…</option>' +
        others.map(function (x) {
          return '<option value="' + esc(x.id) + '">' + esc(x.name + (gymAddress(x) ? " — " + gymAddress(x) : "")) + "</option>";
        }).join("") + "</select>" +
        '<p class="adm-hint">' + esc(g.name) + " goes away and its " + esc(plural(g.sessions || 0, "workout")) +
          " move to the gym you choose. People's phones follow along the next time they open the app. This can't be undone.</p>" +
        '<p class="adm-note" role="alert"></p>' +
        '<div class="adm-row-actions"><button type="submit" class="adm-btn danger" data-armed="">Merge</button></div></form>';
    }
    return html + "</div>";
  }).join("");
}

function findGym(id) { return gyms.filter(function (g) { return g.id === id; })[0]; }

function saveGym(item, form) {
  var g = findGym(item.getAttribute("data-gym"));
  if (!g) return;
  var val = function (f) { return form.querySelector('[data-f="' + f + '"]').value.trim(); };
  var note = form.querySelector(".adm-note");
  var name = val("name");
  var latText = val("lat"), lngText = val("lng");
  var lat = latText === "" ? null : Number(latText);
  var lng = lngText === "" ? null : Number(lngText);
  if (!name) { note.textContent = "A gym needs a name."; return; }
  if ((lat === null) !== (lng === null)) { note.textContent = "Give both latitude and longitude, or clear both."; return; }
  if (lat !== null && (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
    note.textContent = "Those coordinates are off the map. Latitude is −90 to 90, longitude −180 to 180.";
    return;
  }
  var btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  note.textContent = "";
  var next = { name: name, street: val("street"), city: val("city"), state: val("state"), lat: lat, lng: lng };
  call("admin_update_gym", {
    p_gym: g.id, p_name: next.name, p_street: next.street, p_city: next.city, p_state: next.state, p_lat: lat, p_lng: lng,
  }).then(function () {
    Object.keys(next).forEach(function (k) { g[k] = next[k]; });
    openEditor = null;
    renderGyms();
    toast("Saved " + g.name + ".");
    loadOverview();
  }).catch(function (err) {
    btn.disabled = false;
    if (err.denied) { fail(err); return; }
    note.textContent = err.message;
  });
}

function mergeGym(item, form) {
  var g = findGym(item.getAttribute("data-gym"));
  var into = findGym(form.querySelector("select").value);
  var note = form.querySelector(".adm-note");
  var btn = form.querySelector("button[type=submit]");
  if (!g) return;
  if (!into) { note.textContent = "Choose the gym to keep."; return; }
  // two taps: the first one says exactly what will happen
  if (btn.getAttribute("data-armed") !== into.id) {
    btn.setAttribute("data-armed", into.id);
    btn.textContent = "Yes, merge into " + into.name;
    note.textContent = "";
    return;
  }
  btn.disabled = true;
  call("admin_merge_gyms", { p_from: g.id, p_into: into.id }).then(function (moved) {
    openEditor = null;
    toast(g.name + " merged into " + into.name + " (" + plural(moved || 0, "workout") + " moved).");
    loadGyms();
    loadOverview();
  }).catch(function (err) {
    btn.disabled = false;
    if (err.denied) { fail(err); return; }
    note.textContent = err.message;
  });
}

function hideGym(item, btn) {
  var g = findGym(item.getAttribute("data-gym"));
  if (!g) return;
  btn.disabled = true;
  call("admin_hide_gym", { p_gym: g.id, p_hidden: !g.hidden }).then(function () {
    g.hidden = !g.hidden;
    renderGyms();
    toast(g.hidden ? g.name + " is hidden from the directory." : g.name + " is back in the directory.");
    loadOverview();
  }).catch(function (err) { btn.disabled = false; fail(err); });
}

/* ------------------------------ wiring ------------------------------ */

function toggleEditor(key, render) {
  openEditor = openEditor === key ? null : key;
  render();
  var first = document.querySelector(".adm-edit input, .adm-edit select");
  if (first && openEditor) first.focus();
}

function start() {
  $("adm-auth-form").addEventListener("submit", submitAuth);
  $("adm-auth-switch").addEventListener("click", function () { setAuthMode(authMode === "signin" ? "signup" : "signin"); });
  $("adm-signout").addEventListener("click", signOut);
  $("adm-refresh").addEventListener("click", function () { loadAll(); toast("Refreshed."); });
  $("adm-geo-toggle").addEventListener("click", toggleGeocoding);
  $("adm-people-more").addEventListener("click", function () { loadPeople(false); });

  $("adm-recheck").addEventListener("click", function () {
    Promise.resolve(db.auth.getSession()).then(function (res) {
      var s = res.data && res.data.session;
      if (s) enter(s); else signOut();
    });
  });
  $("adm-copy-sql").addEventListener("click", function () {
    var text = $("adm-blocked-sql").textContent;
    var done = function () { toast("Copied."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast("Select the text and copy it."); });
    else toast("Select the text and copy it.");
  });

  $("adm-people-search").addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { openEditor = null; loadPeople(true); }, 300);
  });
  $("adm-gyms-search").addEventListener("input", function () { openEditor = null; renderGyms(); });

  $("adm-people").addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-act]");
    var item = ev.target.closest("[data-user]");
    if (btn && item) toggleEditor("user:" + item.getAttribute("data-user"), renderPeople);
  });
  $("adm-people").addEventListener("submit", function (ev) {
    ev.preventDefault();
    saveUsername(ev.target.closest("[data-user]"), ev.target);
  });

  $("adm-gyms").addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-act]");
    var item = ev.target.closest("[data-gym]");
    if (!btn || !item) return;
    var act = btn.getAttribute("data-act");
    if (act === "hide") hideGym(item, btn);
    else toggleEditor("gym:" + item.getAttribute("data-gym") + ":" + act, renderGyms);
  });
  $("adm-gyms").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var item = ev.target.closest("[data-gym]");
    if (ev.target.getAttribute("data-form") === "merge") mergeGym(item, ev.target);
    else saveGym(item, ev.target);
  });
  // choosing a different gym to keep takes the merge button back a step
  $("adm-gyms").addEventListener("change", function (ev) {
    if (ev.target.id !== "adm-merge-into") return;
    var btn = ev.target.closest("form").querySelector("button[type=submit]");
    btn.setAttribute("data-armed", "");
    btn.textContent = "Merge";
  });

  setAuthMode("signin");
  Promise.resolve(db.auth.getSession()).then(function (res) {
    var s = res.data && res.data.session;
    if (s) enter(s); else show("adm-auth");
  }).catch(function () { show("adm-auth"); });
}

start();
