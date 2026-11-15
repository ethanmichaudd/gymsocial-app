/**
 * The developer account: the developer page (admin.html), and how the app
 * itself treats a developer account and a merged gym.
 *
 * Runs against the stand-in Supabase in tests/support/supabase.js. The
 * database rules themselves (who may call what) live in
 * supabase/010_admin.sql and are not what this file tests; here the
 * stand-in says "yes" or "no" and the page has to behave. Run with: npm test
 */
import { test } from "@playwright/test";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, ME, MAYA, G1, G2, G3, G4, W1 } from "./support/supabase.js";

const ADMIN = URL_ + "admin.html";
const APP_TOKEN = "sb-kmhndltnnlhovykfffjg-auth-token";
const flat = (t) => t.replace(/\s+/g, " ").trim();

async function openPage(browser, url, { db = makeDb(), width = 390, height = 844, dark = false, signedIn = false } = {}) {
  const phone = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone, serviceWorkers: "block", colorScheme: dark ? "dark" : "light" });
  await install(context, db); await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(url);
  await page.waitForTimeout(900);
  return { context, page, db, errors };
}

async function signInDev(page, name = "gymsocial_dev", pw = "correct horse battery") {
  await page.fill("#adm-user", name);
  await page.fill("#adm-pass", pw);
  await page.click("#adm-auth-go");
  await page.waitForTimeout(700);
}

const visible = (page, sel) => page.locator(sel).isVisible();
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("developer page: who gets in", async ({ browser }) => {
  const db = makeDb();
  db.logins = { gymsocial_dev: "correct horse battery" };
  db.noAdminSql = true;
  const { context, page, errors } = await openPage(browser, ADMIN, { db });
  const T = "gate: ";

  check(T + "signed out: a sign-in form", await visible(page, "#adm-auth") && !(await visible(page, "#adm-main")));
  check(T + "signed out: nothing was asked of the database", !db.log.some((l) => /rpc\/admin_/.test(l.path)), JSON.stringify(db.log.map((l) => l.path)));
  check(T + "the page asks not to be indexed", (await page.getAttribute('meta[name="robots"]', "content")).includes("noindex"));

  await signInDev(page, "gymsocial_dev", "wrong");
  check(T + "wrong password says so", /Wrong username or password/.test(await page.innerText("#adm-auth-note")), await page.innerText("#adm-auth-note"));

  // database hasn't run 010 yet
  await signInDev(page);
  check(T + "before 010: told to run it", /010_admin\.sql/.test(await page.innerText("#adm-blocked")) && !(await visible(page, "#adm-main")), flat(await page.innerText("#adm-blocked")));

  // 010 run, but this account isn't on the list
  db.noAdminSql = false;
  await page.click("#adm-recheck"); await page.waitForTimeout(600);
  const blockedText = flat(await page.innerText("#adm-blocked"));
  check(T + "a normal account is told it isn't a developer account", /@gymsocial_dev isn.t a developer account yet/.test(blockedText), blockedText);
  check(T + "...and shown the one line to run, with its username", /insert into public\.admins/.test(blockedText) && /username = 'gymsocial_dev'/.test(blockedText), blockedText);
  check(T + "...and sees no numbers, people or gyms", !(await visible(page, "#adm-main")) && (await page.innerText("#adm-people")) === "" && (await page.innerText("#adm-tiles")) === "");
  check(T + "...and nothing was fetched for it", !db.log.some((l) => /rpc\/admin_/.test(l.path)));
  await page.screenshot({ path: SCREENS + "/admin-not-developer.png" });

  // the SQL line was run
  db.isAdmin = true;
  await page.click("#adm-recheck"); await page.waitForTimeout(900);
  check(T + "once it's on the list, the page opens", await visible(page, "#adm-main") && /@gymsocial_dev/.test(await page.innerText("#adm-who")));

  // taken off the list while the page is open
  db.isAdmin = false;
  await page.click("#adm-refresh"); await page.waitForTimeout(700);
  check(T + "taken off the list: the page closes again", !(await visible(page, "#adm-main")) && await visible(page, "#adm-blocked"));

  // the app's own sign-in on this device is untouched
  const keys = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  check(T + "its sign-in is kept apart from the app's, and only for this tab", !keys.local.some((k) => /auth/.test(k)) && keys.session.includes("gymsocial-admin-auth"), JSON.stringify(keys));

  await page.click("#adm-signout"); await page.waitForTimeout(400);
  check(T + "sign out returns to the form", await visible(page, "#adm-auth") && !(await page.evaluate(() => Object.keys(sessionStorage).includes("gymsocial-admin-auth"))));

  // creating the account from the page
  await page.click("#adm-auth-switch");
  await page.fill("#adm-user", "new_dev"); await page.fill("#adm-pass", "short"); await page.click("#adm-auth-go");
  check(T + "create: a short password is refused", /at least 10/.test(await page.innerText("#adm-auth-note")), await page.innerText("#adm-auth-note"));
  await page.fill("#adm-pass", "a much longer password"); await page.click("#adm-auth-go"); await page.waitForTimeout(700);
  check(T + "create: lands on the 'run this line' step for the new name", /username = 'new_dev'/.test(await page.innerText("#adm-blocked")), flat(await page.innerText("#adm-blocked")));

  check(T + "no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});

for (const size of [{ name: "phone", width: 390, height: 844, dark: false }, { name: "desktop dark", width: 1100, height: 800, dark: true }]) {
  test("developer page: numbers, usernames, gyms (" + size.name + ")", async ({ browser }) => {
    const db = makeDb();
    db.logins = { gymsocial_dev: "correct horse battery" };
    db.isAdmin = true;
    db.gyms.push({ id: "99999999-0000-4000-8000-000000000009", name: "Sam's Garage", street: "", city: "Boston", state: "MA", created_by: ME, lat: null, lng: null, is_private: true });
    const { context, page, errors } = await openPage(browser, ADMIN, { db, width: size.width, height: size.height, dark: size.dark });
    const T = size.name + ": ";
    await signInDev(page);
    await page.waitForTimeout(500);

    // ---- overview ----
    const tiles = flat(await page.innerText("#adm-tiles"));
    check(T + "overview shows accounts, signed in, active and gyms", /5 accounts/.test(tiles) && /3 signed in on a device/.test(tiles) && /2 active in the last day/.test(tiles) && /4 gyms in the directory/.test(tiles) && /1 private gyms/.test(tiles), tiles);
    check(T + "fits the screen", await fits(page));
    await page.screenshot({ path: SCREENS + "/admin-" + size.name.replace(" ", "-") + ".png", fullPage: true });

    // ---- people: the basics and nothing else ----
    const peopleText = flat(await page.innerText("#adm-people"));
    check(T + "lists everyone with username, joined, active and workouts", (await page.locator("#adm-people .adm-item").count()) === 5 && /Maya Jensen@mayaj/.test(peopleText.replace(/ @/g, "@")) && /Joined .* · Active .* · 1 workout/.test(peopleText), peopleText.slice(0, 300));
    const whole = await page.innerText("body");
    check(T + "no email addresses anywhere on the page", !/users\.gymsocial\.app|@[a-z0-9.]+\.(com|app|mail)/i.test(whole));
    check(T + "no workout content anywhere on the page", !/Leg Day|Push Day|Back Squat|Bench Press|245 for 5/.test(whole));
    check(T + "private gyms are a number, not a name", !/Garage/.test(whole));
    check(T + "someone never seen reads 'never'", /Priya Rao.*Active never/.test(peopleText), peopleText.slice(-160));

    await page.fill("#adm-people-search", "maya"); await page.waitForTimeout(700);
    check(T + "search narrows the list", (await page.locator("#adm-people .adm-item").count()) === 1);

    await page.click('#adm-people [data-act="rename"]');
    check(T + "rename: says they sign in with the new name from then on", /use the new username the next time they sign in/.test(await page.innerText('#adm-people [data-form="rename"]')));
    await page.fill("#adm-new-name", "Not OK!"); await page.click('#adm-people [data-form="rename"] button[type=submit]');
    check(T + "rename: a bad username is caught before sending", /3–20 lowercase/.test(await page.innerText("#adm-people .adm-note")) && !db.log.some((l) => /admin_set_username/.test(l.path)));
    await page.fill("#adm-new-name", "devp"); await page.click('#adm-people [data-form="rename"] button[type=submit]'); await page.waitForTimeout(500);
    check(T + "rename: a taken username is refused, nothing changes", /taken/.test(await page.innerText("#adm-people .adm-note")) && db.profiles.find((p) => p.id === MAYA).username === "mayaj", await page.innerText("#adm-people .adm-note"));
    await page.fill("#adm-new-name", "@Maya.Lifts"); await page.click('#adm-people [data-form="rename"] button[type=submit]'); await page.waitForTimeout(600);
    check(T + "rename: saved", db.profiles.find((p) => p.id === MAYA).username === "maya.lifts", db.profiles.find((p) => p.id === MAYA).username);
    check(T + "rename: the row and a message show the new name", /@maya\.lifts/.test(await page.innerText("#adm-people")) && /@mayaj is now @maya\.lifts/.test(await page.innerText("#adm-toast")), await page.innerText("#adm-toast"));
    await page.fill("#adm-people-search", ""); await page.waitForTimeout(700);

    // ---- gyms ----
    check(T + "gyms: the four public gyms", (await page.locator("#adm-gyms .adm-item").count()) === 4);
    const gymsText = flat(await page.innerText("#adm-gyms"));
    check(T + "gyms: counts and a missing pin are shown", /BU FitRec.*915 Commonwealth Ave, Boston, MA · 1 workout · 1 person · no pin/.test(gymsText), gymsText.slice(0, 300));

    // edit
    const row = (id) => page.locator('#adm-gyms [data-gym="' + id + '"]');
    await row(G3).locator('[data-act="edit"]').click();
    await page.fill("#adm-g-name", "Planet Fitness"); await page.fill("#adm-g-street", "100 Cambridge St"); await page.fill("#adm-g-city", "Boston");
    await row(G3).locator("button[type=submit]").click(); await page.waitForTimeout(500);
    check(T + "edit: an exact duplicate is refused with a hint to merge", /Merge them instead/.test(await row(G3).locator(".adm-note").innerText()), await row(G3).locator(".adm-note").innerText());
    await page.fill("#adm-g-name", "Crunch Fitness Cambridge"); await page.fill("#adm-g-street", "1 Main St"); await page.fill("#adm-g-city", "Cambridge");
    await page.fill("#adm-g-lat", "95"); await row(G3).locator("button[type=submit]").click();
    check(T + "edit: coordinates off the map are caught", /off the map/.test(await row(G3).locator(".adm-note").innerText()));
    await page.fill("#adm-g-lat", "42.3741"); await page.fill("#adm-g-lng", "");
    await row(G3).locator("button[type=submit]").click();
    check(T + "edit: half a pin is caught", /both latitude and longitude/.test(await row(G3).locator(".adm-note").innerText()));
    await page.fill("#adm-g-lng", "-71.1102"); await row(G3).locator("button[type=submit]").click(); await page.waitForTimeout(600);
    const g3 = db.gyms.find((g) => g.id === G3);
    check(T + "edit: saved name and pin", g3.name === "Crunch Fitness Cambridge" && g3.lat === 42.3741 && g3.lng === -71.1102, JSON.stringify(g3));
    check(T + "edit: the list shows it", /Crunch Fitness Cambridge/.test(await page.innerText("#adm-gyms")));

    // merge: two taps
    await row(G4).locator('[data-act="merge"]').click();
    await row(G4).locator("button[type=submit]").click();
    check(T + "merge: needs a gym to keep", /Choose the gym to keep/.test(await row(G4).locator(".adm-note").innerText()));
    await page.selectOption("#adm-merge-into", G1);
    await row(G4).locator("button[type=submit]").click(); await page.waitForTimeout(300);
    check(T + "merge: the first tap only asks", /Yes, merge into Planet Fitness/.test(await row(G4).locator("button[type=submit]").innerText()) && !db.log.some((l) => /admin_merge_gyms/.test(l.path)));
    await page.selectOption("#adm-merge-into", G2);
    check(T + "merge: choosing another gym asks again", (await row(G4).locator("button[type=submit]").innerText()) === "Merge");
    await page.selectOption("#adm-merge-into", G1);
    await row(G4).locator("button[type=submit]").click();
    await row(G4).locator("button[type=submit]").click(); await page.waitForTimeout(800);
    check(T + "merge: done on the second tap", db.gyms.find((g) => g.id === G4).merged_into === G1);
    check(T + "merge: the duplicate leaves the list", (await page.locator("#adm-gyms .adm-item").count()) === 3 && !/Empty Gym/.test(await page.innerText("#adm-gyms")));

    // hide and show
    await row(G2).locator('[data-act="hide"]').click(); await page.waitForTimeout(600);
    check(T + "hide: flagged, still listed here", db.gyms.find((g) => g.id === G2).admin_hidden === true && /BU FitRec\s*Hidden/i.test(await row(G2).innerText()), await row(G2).innerText());
    check(T + "hide: the directory count drops", /2 gyms in the directory/.test(flat(await page.innerText("#adm-tiles"))), flat(await page.innerText("#adm-tiles")));
    await row(G2).locator('[data-act="hide"]').click(); await page.waitForTimeout(600);
    check(T + "show: back in the directory", db.gyms.find((g) => g.id === G2).admin_hidden === false && !/Hidden/i.test(await row(G2).innerText()));

    await page.fill("#adm-gyms-search", "cambridge");
    check(T + "gym search filters by name or address", (await page.locator("#adm-gyms .adm-item").count()) === 2);
    await page.fill("#adm-gyms-search", "");

    // ---- map switch ----
    check(T + "lookups start on", (await page.innerText("#adm-geo-state")) === "on");
    await page.click("#adm-geo-toggle"); await page.waitForTimeout(500);
    check(T + "lookups off is saved and shown", db.geocodingOff === true && (await page.innerText("#adm-geo-state")) === "off" && (await page.innerText("#adm-geo-toggle")) === "Turn on");
    await page.click("#adm-geo-toggle"); await page.waitForTimeout(500);
    check(T + "lookups back on", db.geocodingOff === false && (await page.innerText("#adm-geo-state")) === "on");

    check(T + "still fits the screen with a form open", await (async () => { await row(G1).locator('[data-act="edit"]').click(); return fits(page); })());
    check(T + "the page never wrote to a normal table", !db.log.some((l) => /rest\/v1\/(?!rpc\/)/.test(l.path)), JSON.stringify(db.log.filter((l) => /rest\/v1\/(?!rpc\/)/.test(l.path)).map((l) => l.path)));
    check(T + "no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  });
}

test("developer page: a database without session records", async ({ browser }) => {
  const db = makeDb();
  db.logins = { gymsocial_dev: "correct horse battery" };
  db.isAdmin = true; db.noSessions = true;
  const { context, page, errors } = await openPage(browser, ADMIN, { db });
  await signInDev(page); await page.waitForTimeout(500);
  const tiles = flat(await page.innerText("#adm-tiles"));
  check("no sessions: the signed-in tile shows a dash, not a zero", /– signed in on a device/.test(tiles), tiles);
  check("no sessions: the note explains", /aren.t available/.test(await page.innerText("#adm-tiles-note")));
  check("no sessions: no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});

test("the app turns a developer account away", async ({ browser }) => {
  const T = "app: ";
  // signing in with it
  {
    const db = makeDb();
    db.logins = { gymsocial_dev: "correct horse battery", ethan: "hunter22" };
    db.isAdmin = true;
    const { context, page, errors } = await openPage(browser, URL_, { db });
    await page.click("#open-settings"); await page.waitForTimeout(300);
    await page.click('[data-open-auth="signin"]'); await page.waitForTimeout(300);
    await page.fill("#auth-email", "gymsocial_dev"); await page.fill("#auth-password", "correct horse battery");
    await page.click("#auth-submit"); await page.waitForTimeout(1500);
    check(T + "sign-in with the developer account is refused, with the reason", /developer account/i.test(await page.innerText("#auth-note")), await page.innerText("#auth-note"));
    check(T + "...and the app is left signed out", !(await page.evaluate((k) => localStorage.getItem(k), APP_TOKEN)));
    check(T + "...and nothing was uploaded for it", !db.log.some((l) => /rest\/v1\/(profiles|workouts|gyms|exercises)/.test(l.path)), JSON.stringify(db.log.map((l) => l.method + " " + l.path)));
    check(T + "no page errors", errors.length === 0, errors.join(" | "));

    // a normal account still signs in
    db.isAdmin = false;
    await page.fill("#auth-email", "ethan"); await page.fill("#auth-password", "hunter22");
    await page.click("#auth-submit"); await page.waitForTimeout(2500);
    check(T + "a normal account signs in as before", !!(await page.evaluate((k) => localStorage.getItem(k), APP_TOKEN)) && !(await page.locator("#auth-page").isVisible()));
    check(T + "...and syncs", (await page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")).workouts.length)) >= 1);
    await context.close();
  }
  // an account that was already signed in here, then made a developer account
  {
    const db = makeDb();
    db.isAdmin = true;
    const { context, page, errors } = await openPage(browser, URL_, { db, signedIn: true });
    await page.waitForTimeout(2200);
    check(T + "a session that became a developer account is signed out", !(await page.evaluate((k) => localStorage.getItem(k), APP_TOKEN)));
    check(T + "...without syncing anything", !db.log.some((l) => /rest\/v1\/(profiles|workouts|gyms|exercises)$/.test(l.path)), JSON.stringify(db.log.map((l) => l.method + " " + l.path)));
    check(T + "no page errors (restored session)", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // a database that hasn't run 010: nobody is a developer, everything works
  {
    const db = makeDb();
    db.noAdminSql = true;
    const { context, page, errors } = await openPage(browser, URL_, { db, signedIn: true });
    await page.waitForTimeout(2200);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")));
    check(T + "before 010 is run: still signed in and synced", !!(await page.evaluate((k) => localStorage.getItem(k), APP_TOKEN)) && st.workouts.some((w) => w.title === "Leg Day"));
    check(T + "before 010 is run: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
});

test("a merged gym follows on the phone", async ({ browser }) => {
  const T = "merge: ";
  const db = makeDb();
  db.profiles[0].settings = { theme: "light", customEquipment: [], homeGymId: G2 };
  const { context, page, errors } = await openPage(browser, URL_, { db, signedIn: true });
  await page.waitForTimeout(2200);
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")));
  check(T + "before: the phone has BU FitRec, with a workout there", st.gyms.some((g) => g.id === G2) && st.workouts.find((w) => w.id === W1).gymId === G2);

  // a developer merges BU FitRec into Planet Fitness
  const kept = db.gyms.find((g) => g.id === G1);
  db.gyms.find((g) => g.id === G2).merged_into = G1;
  db.workouts.forEach((w) => { if (w.gym_id === G2) w.gym_id = G1; });
  db.redirects = [{ from_id: G2, id: G1, name: kept.name, street: kept.street, city: kept.city, state: kept.state, lat: kept.lat, lng: kept.lng, is_private: false }];
  db.log.length = 0;

  await page.reload(); await page.waitForTimeout(3200);
  st = await page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")));
  check(T + "after: the old gym is off the phone's list", !st.gyms.some((g) => g.id === G2), JSON.stringify(st.gyms.map((g) => g.name)));
  check(T + "after: the kept gym is on it, once, with its pin", st.gyms.filter((g) => g.id === G1).length === 1 && st.gyms.find((g) => g.id === G1).lat === 42.3601);
  check(T + "after: the workout shows the kept gym", st.workouts.find((w) => w.id === W1).gymId === G1);
  check(T + "after: 'my gym' moved with it", st.settings.homeGymId === G1, st.settings.homeGymId);
  check(T + "after: the phone didn't re-create the old gym", !db.log.some((l) => l.method === "POST" && /rest\/v1\/gyms/.test(l.path)), JSON.stringify(db.log.map((l) => l.method + " " + l.path)));

  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(1200);
  const listText = await page.innerText("#places-list");
  check(T + "Gyms screen: Planet Fitness listed, BU FitRec gone", /Planet Fitness/.test(listText) && !/BU FitRec/.test(listText), flat(listText).slice(0, 200));
  check(T + "no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});
