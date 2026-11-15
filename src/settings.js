/**
 * Settings and account: preferences, notifications, sign-in, backup and erase.
 */

import {
  cloudEnabled, currentUser, disablePush, enablePush, pushEnabled, pushPermission, pushSupport,
  signIn, signOut, signUp, syncNow, syncStatus, USERNAME_RULE
} from "./store.js";
import {
  activateTab, applyTheme, closeListSheet, currentTab, equipmentList, esc, findUser,
  isCustomEquipment, migrate, openConfirm, openListSheet, persist, seedState, setState,
  showToast, state, STORAGE_KEY, titleCase
} from "./core.js";
import { renderHome, setCalendarMonth } from "./home.js";
import { liveBlockHtml, wireLive } from "./live.js";
import { draft, editDraft, renderEditModal, renderLog, resetDraft } from "./log.js";
import { openRename, openUsername, renderProfile } from "./profile.js";
import { setSelectedExerciseId } from "./progress.js";

/* ----------------------------- settings ----------------------------- */

function stepperHtml(id, label, value, suffix) {
  return '<div class="param-row">' +
    '<span class="param-label">' + label + '</span>' +
    '<div class="goal-stepper">' +
      '<button class="goal-btn" data-step="' + id + ':-1" aria-label="Decrease">&minus;</button>' +
      '<span class="goal-value">' + value + (suffix || "") + '</span>' +
      '<button class="goal-btn" data-step="' + id + ':1" aria-label="Increase">+</button>' +
    '</div></div>';
}

/* The equipment rails are drawn into the log and edit screens, so a change
   made in Settings has to reach them -- otherwise you close Settings and the
   rail is still showing what you just hid. */
function refreshEquipmentRails(removed) {
  [draft, editDraft].forEach(function (d) {
    if (!d || !d.exercises) return;
    d.exercises.forEach(function (blk) {
      if (removed && blk.equipment === removed) blk.equipment = null;
    });
  });
  renderLog();
  if (document.getElementById("edit-modal-overlay").classList.contains("open")) renderEditModal();
}

/* Your identity lives in two places once state has been through storage. */
export function updateMe(field, value) {
  state.me[field] = value;
  var mirror = findUser(state.me.id);
  if (mirror) mirror[field] = value;
  persist();
}

/* Square-cropped and scaled down before it is stored: a phone photo
   straight from the camera would be megabytes, and browser storage is
   a few. 256px is plenty for a 46px circle on a retina screen. */
function setAvatarFromFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onerror = function () { showToast("Couldn't read that image."); };
  reader.onload = function () {
    var img = new Image();
    img.onerror = function () { showToast("That file isn't an image."); };
    img.onload = function () {
      var size = 256;
      var side = Math.min(img.width, img.height);
      var canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(
        img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      var data;
      try { data = canvas.toDataURL("image/jpeg", 0.82); }
      catch (e) { showToast("Couldn't read that image."); return; }
      updateMe("avatar", data);
      renderProfile();
      renderHome();
      showToast("Photo updated.");
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

export function renderSettings() {
  var el = document.getElementById("settings-body");
  var st = state.settings;
  var mode = st.streakMode;



  var params = "";
  if (mode === "weekly") {
    params = stepperHtml("weeklyGoal", "Workouts per week", st.weeklyGoal, "/wk");
  } else if (mode === "custom") {
    params = stepperHtml("customCount", "Workouts", st.customCount) +
      stepperHtml("customDays", "Every", st.customDays, " days");
  }

  var hidden = st.hiddenEquipment || [];
  var theme = st.theme === "dark" ? "dark" : "light";

  var modeHelp = {
    weekly: "Counts Sunday-Saturday weeks that hit your target. Rest days never break it.",
    daily: "Counts consecutive days trained. Strict -- a single rest day resets it.",
    custom: "Counts rolling windows that hit your target. Good for a flexible schedule."
  }[mode];

  el.innerHTML =
    '<div>' +
      accountBlockHtml() +
      notifyBlockHtml() +
      liveBlockHtml() +
      '<div class="setting-block">' +
        '<label class="field-label">Equipment</label>' +
        '<div class="equip-wrap">' +
          equipmentList(true).map(function (eq) {
            return isCustomEquipment(eq)
              ? '<button class="equip-btn" data-del-equip="' + esc(eq) + '">' + esc(eq) +
                  '<span class="x">&times;</span></button>'
              : '<button class="equip-btn is-builtin' + (hidden.indexOf(eq) !== -1 ? " is-off" : "") +
                  '" data-hide-equip="' + esc(eq) + '">' + esc(eq) + '</button>';
          }).join("") +
        '</div>' +
        '<div class="equip-add">' +
          '<input type="text" id="set-equip" placeholder="Add your own">' +
          '<button class="btn btn-ghost" data-add-equip="1">Add</button>' +
        '</div>' +
        '<p class="setting-help">Tap a built-in to hide it from the rail; tap one of yours to delete it. ' +
          'Past sessions keep whatever they were logged with. The rail only shows on Reps.</p>' +
      '</div>' +

      '<div class="setting-block">' +
        '<label class="field-label">Appearance</label>' +
        '<div class="segmented">' +
          [["light", "Light"], ["dark", "Dark"]].map(function (o) {
            return '<button class="seg-btn' + (theme === o[0] ? " selected" : "") +
              '" data-theme-set="' + o[0] + '">' + o[1] + '</button>';
          }).join("") +
        '</div>' +
      '</div>' +

      '<div class="setting-block">' +
        '<label class="field-label">Streak counted by</label>' +
        '<div class="segmented">' +
          ["weekly", "daily", "custom"].map(function (m) {
            return '<button class="seg-btn' + (mode === m ? " selected" : "") + '" data-mode="' + m + '">' +
              m.charAt(0).toUpperCase() + m.slice(1) + '</button>';
          }).join("") +
        '</div>' +
        params +
        '<p class="setting-help">' + modeHelp + '</p>' +
      '</div>' +

      /* Anything that can overwrite or wipe your log lives down here, away
         from the everyday settings, so it is never a stray tap away. */
      '<div class="settings-data">' +
        '<button class="settings-row" id="open-data">' +
          '<span class="settings-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/></svg></span>' +
          '<span class="person-body"><span class="person-name">Data</span>' +
            '<span class="person-sub">Back up, restore or erase</span></span>' +
          '<span class="chevron">&rsaquo;</span>' +
        '</button>' +
      '</div>' +
    '</div>';

  wireAccount(el);
  wireNotify(el);
  wireLive(el);
  el.querySelector("#open-data").addEventListener("click", openDataSheet);

  var equipInput = el.querySelector("#set-equip");
  el.querySelector("[data-add-equip]").addEventListener("click", function () {
    var v = titleCase(equipInput.value);
    if (!v) return;
    var taken = equipmentList().filter(function (x) {
      return x.toLowerCase() === v.toLowerCase();
    })[0];
    if (taken) { showToast("\"" + taken + "\" is already on the list."); return; }
    state.settings.customEquipment.push(v);
    persist();
    renderSettings();
    refreshEquipmentRails(null);
  });
  el.querySelectorAll("[data-hide-equip]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.getAttribute("data-hide-equip");
      var off = state.settings.hiddenEquipment;
      var at = off.indexOf(name);
      if (at === -1) off.push(name); else off.splice(at, 1);
      persist();
      renderSettings();
      refreshEquipmentRails(at === -1 ? name : null);
    });
  });
  el.querySelectorAll("[data-theme-set]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.settings.theme = btn.getAttribute("data-theme-set");
      persist();
      applyTheme();
      renderSettings();
    });
  });
  el.querySelectorAll("[data-del-equip]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.getAttribute("data-del-equip");
      state.settings.customEquipment = state.settings.customEquipment.filter(function (x) {
        return x !== name;
      });
      persist();
      renderSettings();
      refreshEquipmentRails(name);
    });
  });

  el.querySelectorAll("[data-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.settings.streakMode = btn.getAttribute("data-mode");
      persist();
      renderSettings();
      renderHome();
    });
  });

  el.querySelectorAll("[data-step]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var parts = btn.getAttribute("data-step").split(":");
      var key = parts[0], delta = Number(parts[1]);
      var limits = { weeklyGoal: [1, 7], customCount: [1, 30], customDays: [2, 60] };
      var lo = limits[key][0], hi = limits[key][1];
      state.settings[key] = Math.min(hi, Math.max(lo, state.settings[key] + delta));
      persist();
      renderSettings();
      renderHome();
    });
  });
}

/* ----------------------------- notifications ----------------------------- */

/* One switch. On an iPhone it only works from the Home Screen app, so in
   Safari it explains how to get there instead of failing quietly. */
function notifyBlockHtml() {
  if (!cloudEnabled() || !currentUser()) return "";
  var support = pushSupport();
  var denied = pushPermission() === "denied";
  var help = support === "needs-install"
    ? 'Notifications only work in the Home Screen app. In Safari tap <strong>Share</strong> \u2192 ' +
      '<strong>Add to Home Screen</strong>, then open GymSocial from your Home Screen and turn this on.'
    : support === "unsupported"
      ? "This browser can't receive notifications."
      : denied
        ? 'Notifications are blocked for GymSocial. Turn them back on in iPhone ' +
          '<strong>Settings \u2192 Notifications \u2192 GymSocial</strong>.'
        : "When friends log a workout, react to yours, or send you a friend request.";
  var usable = support === "ok" && !denied;
  return '<div class="setting-block">' +
    '<div class="switch-row">' +
      '<label class="field-label" for="notify-switch" style="margin:0;">Notifications</label>' +
      '<button class="switch" id="notify-switch" role="switch" aria-checked="false"' +
        (usable ? '' : ' disabled') + '><span></span></button>' +
    '</div>' +
    '<p class="setting-help" id="notify-help">' + help + '</p>' +
  '</div>';
}

/* Right after a save is when a nudge makes sense: you just logged, and
   notifications are how you'd hear that a friend did. Asked at most once
   a week, and never once they're on, blocked, or impossible here. */
var NOTIFY_ASK_KEY = "gymsocial_notify_asked";

export function maybeAskNotifications() {
  if (!cloudEnabled() || !currentUser()) return;
  if (pushSupport() !== "ok" || pushPermission() === "denied") return;
  var last = 0;
  try { last = Number(localStorage.getItem(NOTIFY_ASK_KEY)) || 0; } catch (e) { return; }
  if (Date.now() - last < 7 * 24 * 3600 * 1000) return;
  pushEnabled().then(function (on) {
    if (on) return;
    try { localStorage.setItem(NOTIFY_ASK_KEY, String(Date.now())); } catch (e) { /* ask again later */ }
    setTimeout(function () {
      openConfirm({
        title: "Want notifications?",
        body: "Get a heads-up when your friends log a workout or react to yours.",
        confirmLabel: "Yes, turn on",
        cancelLabel: "Not now",
        danger: false,
        // straight from the tap: iPhone only shows the permission prompt then
        onConfirm: function () {
          enablePush()
            .then(function () { showToast("Notifications on."); })
            .catch(function (err) {
              var m = err && err.message;
              if (m === "denied") showToast("Notifications are blocked. Turn them on in iPhone Settings.");
              else if (m !== "dismissed") showToast(m || "Couldn't turn on notifications.");
            });
        }
      });
    }, 600);
  }).catch(function () { /* not worth bothering anyone over */ });
}

function wireNotify(el) {
  var sw = el.querySelector("#notify-switch");
  if (!sw) return;
  var set = function (on) { sw.setAttribute("aria-checked", on ? "true" : "false"); };
  if (!sw.disabled) pushEnabled().then(set).catch(function () { set(false); });

  sw.addEventListener("click", function () {
    var turningOn = sw.getAttribute("aria-checked") !== "true";
    sw.disabled = true;
    // enablePush asks for permission first thing: iOS only allows that
    // straight from a tap, so nothing async may come before it
    (turningOn ? enablePush() : disablePush())
      .then(function () {
        set(turningOn);
        showToast(turningOn ? "Notifications on." : "Notifications off.");
      })
      .catch(function (err) {
        var m = err && err.message;
        if (m === "denied") renderSettings();     // swaps in the "blocked" help
        else if (m === "dismissed") showToast("Notifications stay off.");
        else showToast(m || "Couldn't change notifications.");
      })
      .then(function () { if (document.body.contains(sw)) sw.disabled = false; });
  });
}

/* ----------------------------- account ----------------------------- */

export function syncLine() {
  var st = syncStatus();
  if (st.status === "syncing") return "Syncing\u2026";
  if (st.status === "offline") return "Offline \u2014 changes will sync when you're back online.";
  if (st.status === "error") return "Couldn't sync. Tap Sync now to try again.";
  if (st.status === "synced" && st.lastSynced) {
    var mins = Math.round((Date.now() - st.lastSynced) / 60000);
    return "Synced " + (mins < 1 ? "just now" : mins + " min ago") + ".";
  }
  return "";
}

function accountBlockHtml() {
  if (!cloudEnabled()) return "";
  var user = currentUser();
  if (user) {
    return '<div class="setting-block">' +
      '<label class="field-label">Account</label>' +
      '<div class="account-row">' +
        '<span class="account-label">Signed in as</span>' +
        '<strong class="account-value">@' + esc(state.me.handle || "") + '</strong>' +
        '<button class="account-edit" id="account-username">Change</button>' +
      '</div>' +
      '<div class="account-row">' +
        '<span class="account-label">Display name</span>' +
        '<strong class="account-value">' +
          (state.me.name && state.me.name !== "You" ? esc(state.me.name) : '<span class="is-unset">Not set</span>') +
        '</strong>' +
        '<button class="account-edit" id="account-name">Change</button>' +
      '</div>' +
      '<p class="setting-help" id="sync-line" style="margin-top:4px;">' + esc(syncLine()) + '</p>' +
      '<div class="action-row" style="margin-bottom:0;">' +
        '<button class="btn btn-ghost" id="sync-now-btn">Sync now</button>' +
        '<button class="btn btn-ghost" id="sign-out-btn">Sign out</button>' +
      '</div>' +
    '</div>';
  }
  return '<div class="setting-block">' +
    '<label class="field-label">Account</label>' +
    '<p class="setting-help" style="margin-top:0;">Sign in to back up your workouts, use them on any phone, and see your friends.</p>' +
    '<div class="action-row" style="margin-bottom:0;">' +
      '<button class="btn btn-primary" data-open-auth="signin">Sign in</button>' +
      '<button class="btn btn-ghost" data-open-auth="signup">Create account</button>' +
    '</div>' +
  '</div>';
}

/* ----------------------------- sign-in page ----------------------------- */

/* A full screen of its own rather than a form in Settings: it is the first
   thing a friend sees when you send them the link. */
var authMode = "signin";

function setAuthMode(mode) {
  authMode = mode;
  var up = mode === "signup";
  document.getElementById("auth-title").textContent = up ? "Create your account" : "Welcome back";
  document.getElementById("auth-sub").textContent = up
    ? "Log your workouts and see when your friends train."
    : "Sign in to see your friends and sync your workouts.";
  document.getElementById("auth-submit").textContent = up ? "Create account" : "Sign in";
  document.getElementById("auth-password").setAttribute("autocomplete", up ? "new-password" : "current-password");
  document.getElementById("auth-switch").innerHTML = up
    ? 'Already have an account? <button type="button" data-auth-mode="signin">Sign in</button>'
    : 'New to GymSocial? <button type="button" data-auth-mode="signup">Create an account</button>';
  document.querySelectorAll(".auth-tabs [data-auth-mode]").forEach(function (b) {
    b.classList.toggle("is-on", b.getAttribute("data-auth-mode") === mode);
  });
  authNote("");
}

export function authNote(text, ok) {
  var n = document.getElementById("auth-note");
  n.textContent = text;
  n.classList.toggle("is-ok", !!ok);
}

export function openAuth(mode) {
  setAuthMode(mode || "signin");
  document.getElementById("auth-page").hidden = false;
  document.body.classList.add("auth-open");
}

function closeAuth() {
  document.getElementById("auth-page").hidden = true;
  document.body.classList.remove("auth-open");
  document.getElementById("auth-password").value = "";
}

function wireAccount(el) {
  var uBtn = el.querySelector("#account-username");
  if (uBtn) uBtn.addEventListener("click", openUsername);
  var nBtn = el.querySelector("#account-name");
  if (nBtn) nBtn.addEventListener("click", openRename);

  var nowBtn = el.querySelector("#sync-now-btn");
  if (nowBtn) nowBtn.addEventListener("click", function () { syncNow(); });

  var outBtn = el.querySelector("#sign-out-btn");
  if (outBtn) outBtn.addEventListener("click", function () {
    openConfirm({
      title: "Sign out?",
      body: "Your synced workouts stay in your account. This phone's copy is cleared \u2014 sign back in to get it back.",
      confirmLabel: "Sign out",
      onConfirm: function () {
        syncNow().then(function () {
          var st = syncStatus().status;
          if (st === "error" || st === "offline") {
            // a stuck sync shouldn't trap you in an account
            openConfirm({
              title: "Sign out anyway?",
              body: "Some changes on this phone haven't synced and will be lost.",
              confirmLabel: "Sign out anyway",
              onConfirm: function () { signOut(STORAGE_KEY); }
            });
            return;
          }
          signOut(STORAGE_KEY);
        });
      }
    });
  });
}

function wireEraseButton(el) {
  var btn = el.querySelector("#reset-demo-btn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var n = state.workouts.filter(function (w) { return w.userId === state.me.id; }).length;
    openConfirm({
      title: "Erase everything?",
      body: "This deletes " + n + (n === 1 ? " workout" : " workouts") +
        ", your gyms and your exercises. It cannot be undone -- export a backup first.",
      confirmLabel: "Erase everything",
      onConfirm: function () {
        closeListSheet();
        setState(seedState());
        setSelectedExerciseId(null);
        setCalendarMonth(null);
        resetDraft();
        persist();
        applyTheme();
        activateTab("home");
        showToast("Everything erased.");
      }
    });
  });
}

/* ----------------------------- settings sheet ----------------------------- */

/* The menu button is a toggle: it opens Settings, and pressing it again
   puts you back on whatever screen you came from rather than on Home. */
var settingsReturnTo = "home";

export function openSettings() {
  if (currentTab === "settings") {
    activateTab(settingsReturnTo || "home");
    return;
  }
  settingsReturnTo = currentTab;
  activateTab("settings");
}

/* ----------------------------- backup ----------------------------- */

/* The artifact viewer blocks page-initiated downloads, so a backup is text
   you copy out and paste back in -- which also happens to be the format
   that can seed a real database later. */
/* Backup and erase, in a sheet of their own: everything that can
   overwrite or wipe your log is behind one deliberate tap. */
function openDataSheet() {
  var el = openListSheet("Data",
      '<div class="setting-block">' +
        '<label class="field-label">Backup</label>' +
        '<div class="action-row" style="margin-bottom:0;">' +
          '<button class="btn btn-ghost" data-backup="export">Export data</button>' +
          '<button class="btn btn-ghost" data-backup="import">Restore</button>' +
        '</div>' +
        '<p class="setting-help">Browser storage isn\'t permanent. Export a copy you can paste back in, or move to a new phone.</p>' +
      '</div>' +
      '<div class="setting-block">' +
        '<label class="field-label">Erase</label>' +
        '<button class="btn btn-ghost btn-block" id="reset-demo-btn" ' +
          'style="color:var(--danger);border-color:var(--danger);">Erase all my data</button>' +
        '<p class="setting-help">Deletes every workout, gym and exercise' + (currentUser() ? ', here and in your account on every device' : ' on this phone') + '. ' +
          'Export a backup first.</p>' +
      '</div>');
  wireEraseButton(el);
  el.querySelectorAll("[data-backup]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.getAttribute("data-backup") === "export") openExportSheet();
      else openImportSheet();
    });
  });
}

function openExportSheet() {
  var json = JSON.stringify(state, null, 2);
  var el = openListSheet("Export your data",
    '<p class="setting-help" style="margin-top:0;">Copy this and keep it somewhere safe &mdash; a note, an email to yourself, a file. Paste it into Restore to bring it back.</p>' +
    '<textarea id="export-box" class="backup-box" readonly>' + esc(json) + '</textarea>' +
    '<button class="btn btn-primary btn-block" id="copy-export">Copy to clipboard</button>' +
    '<p class="setting-help" id="copy-note">' + (state.workouts.length) +
      ' workouts &middot; ' + state.gyms.length + ' gyms &middot; ' +
      Math.round(json.length / 1024) + ' KB</p>');

  el.querySelector("#copy-export").addEventListener("click", function () {
    var box = document.getElementById("export-box");
    var done = function () { document.getElementById("copy-note").textContent = "Copied."; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(done, function () { box.select(); });
    } else {
      box.select();
      box.setSelectionRange(0, json.length);
      try { document.execCommand("copy"); done(); } catch (e) { /* user copies manually */ }
    }
  });
}

function openImportSheet() {
  var el = openListSheet("Restore from backup",
    '<p class="setting-help" style="margin-top:0;">Paste an exported backup. This replaces everything currently in this browser.</p>' +
    '<textarea id="import-box" class="backup-box" placeholder="Paste your backup here..."></textarea>' +
    '<button class="btn btn-primary btn-block" id="do-import">Restore</button>' +
    '<p class="setting-help" id="import-note"></p>');

  el.querySelector("#do-import").addEventListener("click", function () {
    var raw = document.getElementById("import-box").value.trim();
    var note = document.getElementById("import-note");
    if (!raw) { note.textContent = "Paste a backup first."; return; }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { note.textContent = "That isn't valid backup text."; return; }
    if (!parsed || !Array.isArray(parsed.workouts) || !parsed.me) {
      note.textContent = "That JSON doesn't look like a GymSocial backup.";
      return;
    }
    openConfirm({
      title: "Replace everything?",
      body: "The backup has " + parsed.workouts.length +
        (parsed.workouts.length === 1 ? " workout" : " workouts") +
        ". Whatever is in this browser now is overwritten.",
      confirmLabel: "Restore",
      onConfirm: function () {
        setState(migrate(parsed));
        setSelectedExerciseId(null);
        setCalendarMonth(null);
        resetDraft();
        persist();
        applyTheme();
        closeListSheet();
        activateTab("home");
        showToast("Restored " + state.workouts.length + " workouts.");
      }
    });
  });
}

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls these in a fixed order. */

export function startSettings1() {
  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-open-auth]");
    if (opener) { openAuth(opener.getAttribute("data-open-auth")); return; }
    var switcher = e.target.closest("#auth-page [data-auth-mode]");
    if (switcher) setAuthMode(switcher.getAttribute("data-auth-mode"));
  });
  document.getElementById("auth-close").addEventListener("click", closeAuth);
  document.getElementById("auth-show").addEventListener("click", function () {
    var pw = document.getElementById("auth-password");
    var show = pw.type === "password";
    pw.type = show ? "text" : "password";
    this.textContent = show ? "Hide" : "Show";
  });
  document.getElementById("auth-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = document.getElementById("auth-email").value.trim().toLowerCase();
    var pw = document.getElementById("auth-password").value;
    var btn = document.getElementById("auth-submit");
    if (!email || !pw) { authNote("Enter your username and a password."); return; }
    if (authMode === "signup" && !USERNAME_RULE.test(email.replace(/^@/, ""))) {
      authNote("Usernames are 3\u201320 lowercase letters, numbers, _ or .");
      return;
    }
    if (authMode === "signup" && pw.length < 6) { authNote("Use at least 6 characters for your password."); return; }
    btn.disabled = true;
    authNote("");
    var done = function () { btn.disabled = false; };

    if (authMode === "signin") {
      signIn(email, pw)
        .then(function () {
          done();
          closeAuth();
          showToast("Signed in. Syncing your workouts.");
          activateTab(currentTab === "settings" ? "settings" : currentTab);
        })
        .catch(function (err) { done(); authNote(err.message || "Couldn't sign in."); });
    } else {
      signUp(email, pw)
        .then(function (needsConfirm) {
          done();
          if (needsConfirm) {
            setAuthMode("signin");
            authNote("Account made, but Supabase still wants email confirmation. Turn off \u201cConfirm email\u201d in its settings.");
          } else {
            closeAuth();
            showToast("Account created. Syncing your workouts.");
            activateTab(currentTab);
          }
        })
        .catch(function (err) { done(); authNote(err.message || "Couldn't create the account."); });
    }
  });
}

export function startSettings2() {
  document.getElementById("avatar-input").addEventListener("change", function (e) {
    setAvatarFromFile(e.target.files && e.target.files[0]);
    e.target.value = "";          // so picking the same file twice still fires
  });
}

export function startSettings3() {
  document.getElementById("open-settings").addEventListener("click", openSettings);
}
