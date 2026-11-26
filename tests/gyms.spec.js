/**
 * Gyms.
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import fs from "node:fs";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, ME, G1, G2, G3, G4 } from "./support/supabase.js";
const flat = (t) => t.replace(/\s+/g, " ").trim();

let browser;      // set by each test: the helpers below open their pages with it


async function open({ signedIn, legacy = false, theme = "light" }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block",
    geolocation: { latitude: 42.3505, longitude: -71.1054 }, permissions: ["geolocation"] });
  const db = makeDb({ legacy });
  db.profiles[0].settings = { theme, customEquipment: [] };
  await install(context, db);
  await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_);
  await page.waitForTimeout(signedIn ? 2500 : 1000);
  if (!signedIn && theme === "dark") { await page.click("#open-settings"); await page.click('[data-theme-set="dark"]'); await page.click("#open-settings"); }
  return { context, page, db, errors };
}
const shot = (page, name) => page.screenshot({ path: `${SCREENS}/${name}.png` });
const rowsText = (page) => page.locator("#places-list .place-row:not(.is-osm)").allInnerTexts().then((a) => a.map((t) => t.replace(/\s+/g, " ").trim()));
const toast = (page) => page.innerText("#toast");
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")));

for (const theme of ["light", "dark"]) test(`Signed in (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ signedIn: true, theme });
  const T = theme + ": ";

  // ---- tab bar ----
  const tabs = await page.locator(".tabbar [data-tab]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tab")));
  check(T + "tab bar is Home, Friends, +, Gyms, Profile", tabs.join() === "home,friends,log,gyms,profile", tabs.join());
  check(T + "map library not loaded before the Gyms tab", (await page.locator(".leaflet-container").count()) === 0 && db.tiles.length === 0);

  // ---- gyms tab ----
  await page.click('[data-tab="gyms"]');
  await page.waitForTimeout(3200);
  let rows = await rowsText(page);
  check(T + "list: 3 gyms people train at, not the empty one", rows.length === 3 && !rows.some((r) => /Empty Gym/.test(r)), rows.join(" || "));
  check(T + "list: friends first, with avatars count and today", /^Planet Fitness - Boston, MA.*1 friend, 1 today.*2 people this month/.test(rows[0] || ""), rows[0]);
  check(T + "list: counts only for strangers' gym", rows.some((r) => /Crunch Fitness - Cambridge, MA.*3 people this month/.test(r)), rows.join(" || "));
  check(T + "map drawn with attribution", (await page.locator("#places-map.leaflet-container").count()) === 1 && /OpenStreetMap/.test(await page.innerText("#places-map .leaflet-control-attribution")));
  check(T + "tiles come from the configured server (no API key needed), Referer sent", db.tiles.length > 0 && db.tiles.every((t) => t.url.startsWith("https://tile.openstreetmap.org/") && t.referer.startsWith(URL_.slice(0, -1))), db.tiles[0] && JSON.stringify(db.tiles[0]));
  check(T + "one style for both themes: " + (theme === "dark" ? "inverted" : "softened"), await page.evaluate((dark) => {
    const f = getComputedStyle(document.querySelector("#places-map .leaflet-tile-pane")).filter;
    return dark ? /invert/.test(f) : /saturate/.test(f) && !/invert/.test(f);
  }, theme === "dark"));
  check(T + "3 pins (one was looked up)", (await page.locator("#places-map .gym-pin:not(.is-osm)").count()) === 3, await page.locator("#places-map .gym-pin:not(.is-osm)").count());
  check(T + "address lookup: one request, for the gym with no pin", db.geo.length === 1 && db.geo[0].q === "915 commonwealth ave, boston, ma" && db.geo[0].format === "jsonv2" && db.geo[0].limit === "1" && db.geo[0].referer.startsWith(URL_.slice(0, -1)), JSON.stringify(db.geo));
  const pinPush = db.log.filter((l) => l.path.endsWith("/rpc/set_gym_location"));
  check(T + "looked-up pin saved for everyone", pinPush.length === 1 && pinPush[0].body.p_gym === G2 && Math.abs(pinPush[0].body.p_lat - 42.3519) < 1e-6, JSON.stringify(pinPush));
  await shot(page, `p2-${theme}-1-gyms`);

  // ---- full-screen map, sheet over it ----
  const mapBox = await page.locator("#places-map").boundingBox();
  check(T + "the map fills the screen between the header and the tab bar", mapBox.height > 600 && mapBox.width >= 386, JSON.stringify(mapBox));
  check(T + "one finger moves the map (it no longer scrolls with a page)", await page.evaluate(() => document.getElementById("places-map").classList.contains("leaflet-touch-drag")));
  check(T + "the sheet starts at half height", (await page.getAttribute("#places-sheet", "data-snap")) === "half");
  const sheetTop = async () => (await page.locator("#places-sheet").boundingBox()).y;
  const half = await sheetTop();
  await page.click("#places-grab"); await page.waitForTimeout(450);
  check(T + "tap the handle: all the way up", (await page.getAttribute("#places-sheet", "data-snap")) === "full" && (await sheetTop()) < half - 200);
  await page.click("#places-grab"); await page.waitForTimeout(450);
  // drag the handle down with a finger-like pointer
  const g = await page.locator("#places-grab").boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 8); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(g.x + g.width / 2, g.y + 8 + i * 45); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(450);
  check(T + "drag it down: tucks away to just the search box", (await page.getAttribute("#places-sheet", "data-snap")) === "peek" && await page.locator("#places-search").isVisible());
  await shot(page, `p2-${theme}-1b-peek`);
  await page.click("#places-grab"); await page.waitForTimeout(450);
  check(T + "and back to half", (await page.getAttribute("#places-sheet", "data-snap")) === "half");

  // ---- real gyms nearby, from the map's data ----
  await page.waitForTimeout(1200);
  const list = flat(await page.innerText("#places-list"));
  check(T + "lists what's in view: IN THIS AREA, then MORE GYMS HERE", /In this area/i.test(list) && /More gyms here/i.test(list), list);
  const osm = await page.locator("#places-list .place-row.is-osm").allInnerTexts();
  check(T + "suggests real gyms nobody has added", osm.some((t) => /Boston Sports Club/.test(t)) && osm.some((t) => /Iron Temple/.test(t)), osm.join(" | "));
  check(T + "but not one that's already on GymSocial, or one with no name", !osm.some((t) => /Planet Fitness/.test(t)) && osm.length === 2, osm.join(" | "));
  check(T + "their pins are on the map too, hollow", (await page.locator("#places-map .gym-pin.is-osm").count()) === 2);
  check(T + "asked politely: POST, the area in view only, Referer sent", db.overpass.length >= 1 && db.overpass.length <= 4 && db.overpass.every((o) => o.method === "POST" && /leisure"="fitness_centre"/.test(o.q) && /\(42\.\d\d,-71\.\d\d,42\.\d\d,-71\.\d\d\)/.test(o.q) && o.referer.startsWith(URL_.slice(0, -1))), JSON.stringify(db.overpass.map((o) => o.q.slice(0, 120))));
  const asked = db.overpass.length;
  await page.evaluate(() => window.scrollTo(0, 0));
  // ---- search: local only ----
  const geoBefore = db.geo.length;
  await page.fill("#places-search", "crunch");
  await page.waitForTimeout(300);
  rows = await rowsText(page);
  check(T + "search by name", rows.length === 1 && /Crunch/.test(rows[0]), rows.join(" || "));
  await page.fill("#places-search", "cambridge, ma");
  await page.waitForTimeout(200);
  check(T + "search by city", (await rowsText(page)).length === 1);
  await page.fill("#places-search", "empty");
  await page.waitForTimeout(200);
  check(T + "search finds a gym nobody has logged at", /Empty Gym/.test((await rowsText(page))[0] || ""));
  await page.fill("#places-search", "zzzz");
  await page.waitForTimeout(200);
  check(T + "no match message + add button", /No gym matches/.test(await page.innerText("#places-list")) && (await page.locator("#places-add").count()) === 1);
  await page.click("#places-clear");
  await page.waitForTimeout(300);
  check(T + "typing never calls the address lookup", db.geo.length === geoBefore, db.geo.length - geoBefore);
  check(T + "search box kept its place (not re-created)", (await page.inputValue("#places-search")) === "" && (await rowsText(page)).length === 3);

  // ---- near me ----
  await page.click("#places-near");
  await page.waitForTimeout(700);
  rows = await rowsText(page);
  check(T + "near me: sorted by distance with miles", /^BU FitRec.*0\.6 mi/.test(rows[0] || "") && /Crunch.*1\.6 mi/.test(rows[1] || "") && /Planet.*2\.3 mi/.test(rows[2] || ""), rows.join(" || "));
  check(T + "near me: you-dot on the map, button on", (await page.locator("#places-map .you-dot").count()) === 1 && (await page.getAttribute("#places-near", "aria-pressed")) === "true");
  await shot(page, `p2-${theme}-2-near`);
  await page.click("#places-near");
  await page.waitForTimeout(300);
  check(T + "near me: off again", (await page.locator("#places-map .you-dot").count()) === 0 && !/ mi/.test((await rowsText(page)).join(" ")));

  // ---- gym page ----
  await page.locator('#places-list .place-row:not(.is-osm)', { hasText: "Planet Fitness" }).click();
  await page.waitForTimeout(900);
  let body = (await page.innerText("#gym-modal-body")).replace(/\s+/g, " ");
  check(T + "gym page: header + address", (await page.innerText("#gym-modal-name")) === "Planet Fitness" && /100 Cambridge St, Boston, MA/.test(await page.innerText("#gym-modal-city")));
  check(T + "gym page: map preview", (await page.locator("#gym-map.leaflet-container .gym-pin").count()) === 1);
  check(T + "gym page: friends by name, today count", /FRIENDS WHO TRAIN HERE MJ Maya · 1 today/i.test(body), body);
  check(T + "gym page: everyone else as a count", /14 people trained here in the last 30 days/.test(body), body);
  check(T + "gym page: popular with sets", /POPULAR HERE last 30 days 1 Bench Press 214 sets 2 Lat Pulldown 160 sets 3 Back Squat 1 set /i.test(body), body);
  check(T + "gym page: busiest hour", /BUSIEST around 6 PM/i.test(body) && (await page.locator("#gym-modal-body .hour").count()) === 24 && (await page.locator("#gym-modal-body .hour.is-peak").count()) === 1, body);
  check(T + "gym page: no Edit for a gym that isn't yours", await page.locator("#gym-modal-edit").isHidden());
  check(T + "gym page sits above the map (not under it)", await page.evaluate(() => { const r = document.getElementById("gym-modal-name").getBoundingClientRect(); const el = document.elementFromPoint(r.left + 5, r.top + 5); return !!el && !!el.closest("#gym-modal-overlay"); }));
  await shot(page, `p2-${theme}-3-gympage`);

  // ---- my gym ----
  const postsBefore = db.log.filter((l) => l.method === "POST" && l.path.endsWith("/gyms")).length;
  await page.click("#gym-home");
  await page.waitForTimeout(300);
  check(T + "set as my gym toggles", /My gym/.test(await page.innerText("#gym-home")) && /is your gym/.test(await toast(page)));
  await page.waitForTimeout(2200);
  const prof = db.log.filter((l) => l.method === "PATCH" && l.path.endsWith("/profiles")).pop();
  check(T + "my gym synced in settings", !!prof && prof.body.settings.homeGymId === G1, prof && JSON.stringify(prof.body.settings).slice(0, 200));
  check(T + "adopting a shared gym doesn't upload a duplicate", db.log.filter((l) => l.method === "POST" && l.path.endsWith("/gyms")).length === postsBefore);
  // ---- check in ----
  await page.click("#gym-checkin");
  await page.waitForTimeout(400);
  check(T + "check in: on the log screen with that gym picked", (await page.locator("#screen-log.active").count()) === 1 && (await page.inputValue("#log-gym")) === G1 && /Checked in at Planet Fitness/.test(await toast(page)), await page.inputValue("#log-gym"));
  await page.click("#log-cancel");
  await page.waitForTimeout(200);
  await page.click('[data-tab="log"]');
  await page.waitForTimeout(200);
  check(T + "new workouts start at my gym", (await page.inputValue("#log-gym")) === G1);
  await page.click("#log-cancel");
  await page.click('[data-tab="gyms"]');
  await page.waitForTimeout(500);
  check(T + "my gym tagged and first in the list", /^Planet Fitness - Boston, MA MY GYM/i.test((await rowsText(page))[0] || ""), (await rowsText(page))[0]);

  // ---- move a pin: refused for a gym you don't train at ----
  await page.locator('#places-list .place-row:not(.is-osm)', { hasText: "Crunch" }).click();
  await page.waitForTimeout(600);
  await page.click("#gym-pin-move");
  await page.waitForTimeout(700);
  let box = await page.locator("#gym-map").boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.3);
  await page.waitForTimeout(300);
  await shot(page, `p2-${theme}-4-movepin`);
  await page.click("#gym-pin-save");
  await page.waitForTimeout(700);
  check(T + "moving a stranger's pin: database's refusal shown", /Only people who train here can move the pin/.test(await toast(page)), await toast(page));
  let s = await state(page);
  check(T + "…and the pin goes back", Math.abs(s.gymDirectory.find((g) => g.id === G3).lat - 42.3736) < 1e-9, s.gymDirectory.find((g) => g.id === G3).lat);
  await page.click("#gym-modal-close");

  // ---- move a pin: your own gym ----
  await page.locator('#places-list .place-row:not(.is-osm)', { hasText: "BU FitRec" }).click();
  await page.waitForTimeout(600);
  check(T + "your own gym has Edit", await page.locator("#gym-modal-edit").isVisible());
  await page.click("#gym-pin-move");
  await page.waitForTimeout(700);
  box = await page.locator("#gym-map").boundingBox();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.7);
  await page.waitForTimeout(200);
  await page.click("#gym-pin-save");
  await page.waitForTimeout(2500);
  const moved = db.log.filter((l) => l.path.endsWith("/rpc/set_gym_location")).pop();
  check(T + "moving your gym's pin saves through sync", /Pin saved/.test(await toast(page)) || moved.body.p_gym === G2, await toast(page));
  check(T + "…to the new spot", moved.body.p_gym === G2 && Math.abs(moved.body.p_lat - 42.3519) > 1e-5, JSON.stringify(moved.body));
  await page.click("#gym-modal-close");

  // ---- finder when logging ----
  await page.click('[data-tab="log"]');
  await page.waitForTimeout(300);
  check(T + "log: button says find or add", /Find or add a gym/.test(await page.innerText("#add-gym-btn")));
  await page.click("#add-gym-btn");
  await page.waitForTimeout(800);
  const finderAll = (await page.locator("#finder-results .place-row").allInnerTexts()).join(" || ").replace(/\s+/g, " ");
  check(T + "finder lists every known gym, including other people's", /Crunch Fitness/.test(finderAll) && /Empty Gym/.test(finderAll) && /BU FitRec/.test(finderAll), finderAll);
  await page.fill("#finder-search", "crun");
  await page.waitForTimeout(200);
  check(T + "finder search narrows + offers to add", (await page.locator("#finder-results .place-row").count()) === 1 && /Add “Crun” as a new gym/.test(await page.innerText("#finder-add")), await page.innerText("#finder-add"));
  await page.locator("#finder-results .place-row").first().click();
  await page.waitForTimeout(400);
  check(T + "finder pick checks you in there", (await page.inputValue("#log-gym")) === G3 && /Checked in at Crunch/.test(await toast(page)), await page.inputValue("#log-gym"));

  // ---- closest match before adding ----
  const gymPosts = () => db.log.filter((l) => l.method === "POST" && l.path.endsWith("/gyms"));
  let before = gymPosts().length;
  await page.click("#add-gym-btn");
  await page.waitForTimeout(500);
  await page.fill("#finder-search", "planet fitness boston");
  await page.waitForTimeout(200);
  await page.click("#finder-add");
  await page.waitForTimeout(300);
  check(T + "add form opens with the typed name", (await page.inputValue("#gym-add-name")) === "Planet Fitness Boston");
  await page.fill("#gym-add-city", "Boston");
  await page.fill("#gym-add-state", "MA");
  await page.click("#gym-add-save");
  await page.waitForTimeout(300);
  check(T + "closest match offered", /Is this the same gym\?/.test(await page.innerText("#confirm-title")) && /Planet Fitness - Boston, MA \(100 Cambridge St, Boston, MA\) is already on your list/.test(await page.innerText("#confirm-body")), await page.innerText("#confirm-body"));
  await shot(page, `p2-${theme}-5-match`);
  await page.click("#confirm-yes");
  await page.waitForTimeout(2000);
  check(T + "“Yes, use it” picks the existing gym, nothing uploaded", (await page.inputValue("#log-gym")) === G1 && gymPosts().length === before, gymPosts().length - before);

  // "No, add mine": different street = a different branch, no question asked at all
  await page.click("#add-gym-btn");
  await page.waitForTimeout(400);
  await page.click("#finder-add");
  await page.fill("#gym-add-name", "planet fitnes");
  await page.fill("#gym-add-city", "boston");
  await page.fill("#gym-add-state", "ma");
  await page.click("#gym-add-save");
  await page.waitForTimeout(300);
  check(T + "a near-miss spelling is caught too", (await page.locator("#confirm-overlay.open").count()) === 1);
  const geoN = db.geo.length;
  await page.click("#confirm-no");
  await page.waitForTimeout(3200);
  const newGym = gymPosts().pop();
  check(T + "“No, add mine” creates it", gymPosts().length === before + 1 && newGym.body.name === "Planet Fitnes" && newGym.body.city === "Boston", JSON.stringify(newGym && newGym.body));
  check(T + "new gym's address looked up once (name + city, no street)", db.geo.length === geoN + 1 && db.geo[geoN].q === "planet fitnes, boston, ma", JSON.stringify(db.geo.slice(geoN)));
  const newPin = db.gyms.find((g) => g.name === "Planet Fitnes");
  check(T + "…and its pin reaches the database", !!newPin && Math.abs(newPin.lat - 42.355) < 1e-6, JSON.stringify(newPin));

  // ---- private gym ----
  await page.click("#add-gym-btn");
  await page.waitForTimeout(400);
  await page.click("#finder-add");
  await page.fill("#gym-add-name", "home gym");
  await page.fill("#gym-add-street", "7 nowhere st");
  await page.fill("#gym-add-city", "boston");
  check(T + "lookup note shown for a normal gym", await page.locator("#gym-add-note").isVisible());
  await page.check("#gym-add-private");
  check(T + "…and hidden once it's private", await page.locator("#gym-add-note").isHidden());
  const geoP = db.geo.length;
  await page.click("#gym-add-save");
  await page.waitForTimeout(2800);
  const priv = gymPosts().pop();
  check(T + "private gym saved as private", priv.body.name === "Home Gym" && priv.body.is_private === true, JSON.stringify(priv.body));
  check(T + "private gym's address is never sent to the lookup", db.geo.length === geoP && !db.geo.some((g) => /nowhere st/.test(g.q)), JSON.stringify(db.geo.slice(geoP)));
  await page.click("#log-cancel");
  await page.waitForTimeout(200);
  if (await page.locator("#confirm-overlay.open").count()) await page.click("#confirm-yes");

  // ---- lookups are spaced out ----
  const gaps = db.geo.slice(1).map((g, i) => g.t - db.geo[i].t);
  check(T + "address lookups at least a second apart", gaps.every((g) => g >= 1000), gaps.join(","));
  check(T + "no address asked twice", new Set(db.geo.map((g) => g.q)).size === db.geo.length, db.geo.map((g) => g.q).join(" | "));

  // ---- progress moved ----
  await page.click('[data-tab="profile"]');
  await page.waitForTimeout(300);
  await shot(page, `p2-${theme}-6-profile`);
  await page.click("#profile-progress");
  await page.waitForTimeout(200);
  check(T + "Progress opens from Profile", (await page.locator("#screen-progress.active").count()) === 1);
  await page.click("#progress-done");
  check(T + "Done goes back to Profile", (await page.locator("#screen-profile.active").count()) === 1);
  await page.click('[data-tab="home"]');
  await page.waitForTimeout(200);
  await page.click('#profile-stats [data-stat="progress"]');
  check(T + "Home's Workouts tile opens Progress", (await page.locator("#screen-progress.active").count()) === 1);
  await page.click("#progress-done");
  check(T + "Done goes back to Home", (await page.locator("#screen-home.active").count()) === 1);
  await page.click('#profile-stats [data-stat="gyms"]');
  await page.waitForTimeout(300);
  check(T + "Home's Gyms tile opens the Gyms tab", (await page.locator("#screen-gyms.active").count()) === 1);

  // ---- workout -> gym ----
  await page.click('[data-tab="friends"]');
  await page.waitForTimeout(400);
  await page.locator(".friend-open").first().click();
  await page.waitForTimeout(300);
  await page.click("#list-modal-body [data-gym-open]");
  await page.waitForTimeout(600);
  check(T + "a workout's gym opens the gym page", (await page.locator("#gym-modal-overlay.open").count()) === 1 && (await page.innerText("#gym-modal-name")) === "Planet Fitness" && (await page.locator("#list-modal-overlay.open").count()) === 0);
  await page.click("#gym-modal-close");
  check(T + "theme applied", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === theme);
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

// ---------- database that hasn't run 008 ----------
test("Database that hasn't run 008", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ signedIn: true, legacy: true });
  await page.click('[data-tab="gyms"]');
  await page.waitForTimeout(6500);
  const rows = await rowsText(page);
  check("pre-008: every gym listed (no counts to filter by)", rows.length === 4 && !/people this month/.test(rows.join(" ")), rows.join(" || "));
  check("pre-008: pins worked out on this phone", (await page.locator("#places-map .gym-pin:not(.is-osm)").count()) === 4, await page.locator("#places-map .gym-pin:not(.is-osm)").count());
  const gaps = db.geo.slice(1).map((g, i) => g.t - db.geo[i].t);
  check("pre-008: lookups still a second apart", db.geo.length === 4 && gaps.every((g) => g >= 1000), db.geo.length + " / " + gaps.join(","));
  await shot(page, "p2-legacy-gyms");
  await page.locator('#places-list .place-row:not(.is-osm)', { hasText: "BU FitRec" }).click();
  await page.waitForTimeout(700);
  const body = (await page.innerText("#gym-modal-body")).replace(/\s+/g, " ");
  check("pre-008: gym page falls back to what you train here", /WHAT YOU TRAIN HERE 1 Back Squat 1 session/i.test(body) && !/Popular here/i.test(body), body);
  await page.click("#gym-modal-close");
  await page.click("#places-add");
  await page.fill("#gym-add-name", "garage");
  await page.fill("#gym-add-city", "boston");
  await page.check("#gym-add-private");
  await page.click("#gym-add-save");
  await page.waitForTimeout(2800);
  check("pre-008: a gym with new fields still syncs (retried without them)", db.gyms.some((g) => g.name === "Garage" && !("is_private" in g)), JSON.stringify(db.gyms.map((g) => g.name)));
  await page.click("#open-settings");
  await page.waitForTimeout(300);
  const line = await page.locator("#sync-line").count() ? await page.innerText("#sync-line") : "";
  check("pre-008: sync is healthy", !/Couldn't sync|Offline/.test(line), line);
  await page.click("#open-settings");
  await page.reload();
  await page.waitForTimeout(2500);
  const n = db.geo.length;
  await page.click('[data-tab="gyms"]');
  await page.waitForTimeout(2500);
  check("pre-008: after a reload the pins come from this phone's memory, no new lookups", db.geo.length === n && (await page.locator("#places-map .gym-pin:not(.is-osm)").count()) === 4, (db.geo.length - n) + " new / pins " + await page.locator("#places-map .gym-pin:not(.is-osm)").count());
  check("pre-008: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

// ---------- lookup switched off from the database ----------
test("Lookup switched off from the database", async ({ browser: b }) => {
  browser = b;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb(); db.geocodingOff = true;
  await install(context, db); await installMaps(context, db);
  await context.addInitScript(sessionScript());
  const page = await context.newPage();
  await page.goto(URL_); await page.waitForTimeout(2500);
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(1500);
  await page.reload(); await page.waitForTimeout(2500);          // config is remembered from the first visit
  db.geo.length = 0;
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(3000);
  check("kill switch: with geocoding off in app_config, no lookups are made", db.geo.length === 0, JSON.stringify(db.geo));
  await context.close();
});

// ---------- signed out ----------
for (const theme of ["light", "dark"]) test(`Signed out (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ signedIn: false, theme });
  const T = `signed out ${theme}: `;
  await page.click('[data-tab="gyms"]');
  await page.waitForTimeout(1500);
  check(T + "empty state, add button, sign-in hint", /No gyms yet/.test(await page.innerText("#places-list")) && /Sign in to see where your friends train/.test(await page.innerText("#places-list")));
  check(T + "map still drawn", (await page.locator("#places-map.leaflet-container").count()) === 1 && /No gyms on the map yet/.test(await page.innerText("#places-map-note")));
  await page.click("#places-add");
  await page.fill("#gym-add-name", "test gym");
  await page.fill("#gym-add-street", "915 commonwealth ave");
  await page.fill("#gym-add-city", "boston");
  await page.fill("#gym-add-state", "ma");
  await page.click("#gym-add-save");
  await page.waitForTimeout(2200);
  check(T + "added gym listed and pinned", /Test Gym - Boston, MA/.test((await rowsText(page))[0] || "") && (await page.locator("#places-map .gym-pin:not(.is-osm)").count()) === 1 && await page.locator("#places-map-note").isHidden(), (await rowsText(page)).join("|"));
  await shot(page, `p2-signedout-${theme}-gyms`);
  await page.locator("#places-list .place-row:not(.is-osm)").first().click();
  await page.waitForTimeout(700);
  const body = (await page.innerText("#gym-modal-body")).replace(/\s+/g, " ");
  check(T + "gym page works without an account", /WHAT YOU TRAIN HERE/i.test(body) && /Check in here/.test(body) && (await page.locator("#gym-map .gym-pin").count()) === 1, body);
  await shot(page, `p2-signedout-${theme}-gympage`);
  await page.click("#gym-checkin");
  await page.waitForTimeout(300);
  check(T + "check in works", (await page.locator("#screen-log.active").count()) === 1 && (await page.locator("#log-gym option:checked").innerText()).includes("Test Gym"));
  await page.click("#log-cancel");
  check(T + "nothing sent to the account server for gyms", !db.log.some((l) => /gym/.test(l.path)));
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

// ---------- a real gym from the map, added in one tap ----------
test("Gyms from the map: add one, and they're asked about once", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ signedIn: true });
  await page.click('[data-tab="gyms"]');
  await page.waitForTimeout(4000);
  const geoBefore = db.geo.length;
  await page.locator("#places-list .place-row.is-osm", { hasText: "Boston Sports Club" }).click();
  await page.waitForTimeout(400);
  const sheet = flat(await page.innerText("#list-modal-body"));
  check("tapping one says it isn't on GymSocial yet, with Add and Directions", /Boston Sports Club/.test(sheet) && /560 Washington St · Boston, MA/.test(sheet) && /Nobody has added this gym/.test(sheet) && (await page.locator("#osm-maps").getAttribute("href")).startsWith("https://maps.apple.com/?q=Boston%20Sports%20Club&ll=42.355,-71.065"), sheet);
  await shot(page, "p2-osm-sheet");
  await page.click("#osm-add"); await page.waitForTimeout(900);
  check("Add: opens its gym page", (await page.innerText("#gym-modal-name")) === "Boston Sports Club");
  const st = await state(page);
  const added = st.gyms.find((g) => g.name === "Boston Sports Club");
  check("added with the map's pin and address, so no lookup was needed", !!added && added.lat === 42.355 && added.lng === -71.065 && added.street === "560 Washington St" && added.city === "Boston" && added.state === "MA" && db.geo.length === geoBefore, JSON.stringify(added) + " geo+" + (db.geo.length - geoBefore));
  await page.waitForTimeout(2500);
  const pushed = db.gyms.find((g) => g.name === "Boston Sports Club");
  check("and it's on GymSocial for everyone, pin included", !!pushed && Math.abs(pushed.lat - 42.355) < 1e-6, JSON.stringify(pushed));
  await page.click("#gym-modal-close"); await page.waitForTimeout(400);
  const osm = await page.locator("#places-list .place-row.is-osm").allInnerTexts();
  check("it's no longer a suggestion, it's a gym", !osm.some((t) => /Boston Sports Club/.test(t)) && (await rowsText(page)).some((t) => /Boston Sports Club - Boston, MA/.test(t)), osm.join(" | "));

  // one with no town: the town is looked up from the pin, once
  await page.locator("#places-list .place-row.is-osm", { hasText: "Iron Temple" }).click();
  await page.waitForTimeout(300);
  await page.click("#osm-add"); await page.waitForTimeout(2200);
  const iron = (await state(page)).gyms.find((g) => g.name === "Iron Temple");
  const rev = db.geo.filter((g) => g.reverse);
  check("no town on the map: asked where the pin is (one reverse lookup)", !!iron && iron.city === "Boston" && iron.state === "MA" && rev.length === 1 && rev[0].lat === "42.348", JSON.stringify(iron) + " " + JSON.stringify(rev));
  await page.click("#gym-modal-close"); await page.waitForTimeout(300);

  // the same area again, after a reload: answered from this phone
  const n = db.overpass.length;
  await page.reload(); await page.waitForTimeout(2500);
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(3500);
  check("coming back to the same area asks nothing new", db.overpass.length === n, (db.overpass.length - n) + " new");
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Gyms from the map: switched off from the database", async ({ browser: b }) => {
  browser = b;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb(); db.placesOff = true;
  await install(context, db); await installMaps(context, db);
  await context.addInitScript(sessionScript());
  const page = await context.newPage();
  await page.goto(URL_); await page.waitForTimeout(2500);
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(3500);
  check("with places off in app_config, the map's data is never asked", db.overpass.length === 0 && (await page.locator("#places-list .place-row.is-osm").count()) === 0, String(db.overpass.length));
  await context.close();
});

// ---------- removing a gym sticks ----------
test("Remove gym: stays removed after a sync and a reload", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ signedIn: true });
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(3000);
  await page.locator("#places-list .place-row:not(.is-osm)", { hasText: "BU FitRec" }).click(); await page.waitForTimeout(600);
  await page.click("#gym-modal-edit"); await page.waitForTimeout(300);
  await page.click("#gym-add-remove"); await page.waitForTimeout(300);
  await page.click("#confirm-yes"); await page.waitForTimeout(500);
  check("gone from your list right away, and from the Gyms tab", !(await state(page)).gyms.some((g) => g.id === G2) && !(await rowsText(page)).some((t) => /BU FitRec/.test(t)), (await rowsText(page)).join(" | "));
  await page.waitForTimeout(3000);
  const up = db.log.filter((l) => l.method === "POST" && l.path.endsWith("/workouts")).map((l) => [].concat(l.body)).flat().filter((r) => r.user_id === ME).pop();
  check("its check-in is cleared in the cloud too", !!up && up.gym_id === null, JSON.stringify(up));
  const prof = db.log.filter((l) => l.method === "PATCH" && l.path.endsWith("/profiles")).pop();
  check("remembered in your settings, so other phones know", !!prof && (prof.body.settings.removedGyms || []).includes(G2), prof && JSON.stringify(prof.body.settings.removedGyms));
  // another sync and a reload: it used to come back here, because you added it
  await page.reload(); await page.waitForTimeout(3500);
  check("after a reload and a full sync it's still gone", !(await state(page)).gyms.some((g) => g.id === G2) && (await state(page)).workouts.every((w) => w.gymId !== G2));
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(2500);
  check("and still off the Gyms tab", !(await rowsText(page)).some((t) => /BU FitRec/.test(t)));
  await page.fill("#places-search", "fitrec"); await page.waitForTimeout(300);
  check("search still finds it, to add back", (await rowsText(page)).some((t) => /BU FitRec/.test(t)));
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
