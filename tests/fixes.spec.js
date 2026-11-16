/**
 * A batch of smaller fixes: clearing the Inbox, drop sets, the + button
 * while a workout is in progress, removing a note, values filled in from
 * last time, and the Friends search with the keyboard up.
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript } from "./support/supabase.js";

const flat = (t) => t.replace(/\s+/g, " ").trim();
const toast = (page) => page.innerText("#toast");
const local = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")));

async function open(browser, { signedIn = true, theme = "light", legacy = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb({ legacy });
  db.profiles[0].settings = { theme, customEquipment: [] };
  await install(context, db); await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_);
  await page.waitForTimeout(signedIn ? 2800 : 1000);
  return { context, page, db, errors };
}

/* Adds an exercise on the Log screen through the real picker. */
async function addExercise(page, exercise) {
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  await page.click("#add-exercise-btn"); await page.waitForTimeout(300);
  await page.fill("#exercise-search", exercise); await page.waitForTimeout(300);
  await page.locator("#exercise-modal-list").locator("button, [data-ex], .picker-row, div").filter({ hasText: new RegExp("^" + exercise, "i") }).first().click();
  await page.waitForTimeout(400);
  if (await page.locator("#exercise-modal-overlay.open").count()) {
    await page.locator("#exercise-modal-list").locator("button, div").filter({ hasText: /Barbell|Cable|Machine/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

for (const mode of [{ name: "light", theme: "light", legacy: false }, { name: "dark, before 011", theme: "dark", legacy: true }]) {
  test("logging fixes (" + mode.name + ")", async ({ browser }) => {
    const { context, page, db, errors } = await open(browser, { theme: mode.theme, legacy: mode.legacy });
    const T = mode.name + ": ";
    const fab = page.locator(".tab-fab");

    // ---- the + button ----
    check(T + "+ is a plus with nothing started", !(await fab.evaluate((el) => el.classList.contains("has-draft"))) && (await fab.getAttribute("aria-label")) === "Log a workout" && await page.locator(".tab-fab .fab-plus").isVisible());
    await addExercise(page, "Back Squat");
    await page.waitForTimeout(500);

    // ---- filled in from last time ----
    const first = page.locator("#exercise-blocks .set-row input").first();
    check(T + "the first set is filled in from last time", (await first.inputValue()) === "5" && (await first.evaluate((el) => el.classList.contains("is-prefill"))), await first.inputValue());
    const colors = await page.evaluate(() => {
      const el = document.querySelector("#exercise-blocks .set-row input");
      const pre = getComputedStyle(el).color;
      el.classList.remove("is-prefill");
      const typed = getComputedStyle(el).color;
      el.classList.add("is-prefill");
      return { pre, typed, body: getComputedStyle(document.querySelector("#log-title")).color };
    });
    check(T + "it looks typed in, not greyed out", colors.pre === colors.typed && colors.pre === colors.body, JSON.stringify(colors));

    await page.click('[data-tab="home"]'); await page.waitForTimeout(400);
    check(T + "+ changes once a workout is in progress", (await fab.evaluate((el) => el.classList.contains("has-draft"))) && (await fab.getAttribute("aria-label")) === "Continue your workout" && await page.locator(".tab-fab .fab-resume").isVisible() && await page.locator(".tab-fab .fab-dot").isVisible() && !(await page.locator(".tab-fab .fab-plus").isVisible()));
    await page.screenshot({ path: `${SCREENS}/fix-${mode.theme}-fab.png` });
    await page.reload(); await page.waitForTimeout(2600);
    check(T + "...and still shows it after the app is reopened", await fab.evaluate((el) => el.classList.contains("has-draft")));
    await fab.click(); await page.waitForTimeout(400);
    check(T + "tapping it goes back to that workout", /Back Squat/.test(await page.innerText("#exercise-blocks")));

    // ---- drop set ----
    const inputs = page.locator("#exercise-blocks .set-row input");
    await inputs.nth(0).fill("5"); await inputs.nth(1).fill("225");
    await page.click("[data-add-drop]"); await page.waitForTimeout(300);
    const rows = page.locator("#exercise-blocks .set-row");
    check(T + "'+ Drop set' adds a set marked with an arrow", (await rows.count()) === 2 && (await rows.nth(1).locator(".set-index").innerText()) === "↓" && await rows.nth(1).evaluate((el) => el.classList.contains("is-drop")));
    check(T + "the drop set starts as a copy of the set before", (await rows.nth(1).locator("input").nth(0).inputValue()) === "5" && (await rows.nth(1).locator("input").nth(1).inputValue()) === "225");
    await rows.nth(1).locator("input").nth(0).fill("8"); await rows.nth(1).locator("input").nth(1).fill("185");
    await page.click("[data-add-set]"); await page.waitForTimeout(300);
    check(T + "'+ Add set' after a drop set is a normal set", (await rows.count()) === 3 && (await rows.nth(2).locator(".set-index").innerText()) === "3");
    await rows.nth(2).locator(".set-index").waitFor();
    await rows.nth(2).locator("[data-remove-set]").click(); await page.waitForTimeout(300);
    await page.click("[data-add-drop]"); await page.waitForTimeout(300);
    await rows.nth(2).locator(".set-index").click(); await page.waitForTimeout(300);
    check(T + "tapping the arrow makes it a normal set again", (await rows.nth(2).locator(".set-index").innerText()) === "3" && !(await rows.nth(2).evaluate((el) => el.classList.contains("is-drop"))));
    await rows.nth(2).locator("[data-remove-set]").click(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENS}/fix-${mode.theme}-dropset.png` });

    // ---- a note can be removed ----
    await page.click("[data-add-note]"); await page.waitForTimeout(200);
    await page.fill(".note-input", "left knee felt off");
    check(T + "a note has a remove button", await page.locator(".note-clear").isVisible());
    await page.click(".note-clear"); await page.waitForTimeout(300);
    check(T + "removing it clears the text and closes the box", (await page.locator(".note-input").count()) === 0 && (await page.locator("[data-add-note]").count()) === 1);
    await page.click("[data-add-note]"); await page.waitForTimeout(200);
    check(T + "...and the box opens empty next time", (await page.inputValue(".note-input")) === "");
    await page.click(".note-clear"); await page.waitForTimeout(200);

    // ---- save ----
    db.log.length = 0;
    await page.click("#save-workout-btn"); await page.waitForTimeout(900);
    if (await page.locator("#confirm-overlay.open").count()) await page.click("#confirm-no");
    await page.click("#summary-done").catch(() => {});
    await page.waitForTimeout(2600);
    check(T + "+ goes back to a plus after saving", !(await fab.evaluate((el) => el.classList.contains("has-draft"))));
    let st = await local(page);
    const mine = st.workouts.filter((w) => w.userId === st.me.id).sort((a, b) => (a.performedAt < b.performedAt ? 1 : -1))[0];
    const sets = mine.exercises[0].sets;
    check(T + "the saved workout remembers which set was the drop set", sets.length === 2 && !sets[0].drop && sets[1].drop === true && sets[1].weight === 185 && !("note" in mine.exercises[0]), JSON.stringify(sets));
    const posts = db.log.filter((l) => l.method === "POST" && /workout_sets$/.test(l.path));
    if (!mode.legacy) {
      check(T + "the marker is sent with the sets", posts.length === 1 && posts[0].body[0].is_drop === false && posts[0].body[1].is_drop === true, JSON.stringify(posts.map((x) => x.body)).slice(0, 300));
    } else {
      check(T + "before 011: refused once, then sent without the marker", posts.length === 2 && "is_drop" in posts[0].body[0] && !("is_drop" in posts[1].body[0]) && posts[1].body.length === 2, JSON.stringify(posts.map((x) => x.body)).slice(0, 300));
    }
    await page.click('[data-tab="home"]'); await page.waitForTimeout(300);
    await addExercise(page, "Back Squat"); await page.waitForTimeout(400);
    check(T + "'Last time' shows the drop set with an arrow", /Last time 5 @ 225lb, ↓ 8 @ 185lb/.test(flat(await page.innerText("#exercise-blocks .last-time"))), flat(await page.innerText("#exercise-blocks .last-time")));

    // it survives another sync. The stand-in database doesn't keep what the app
    // uploads, so put the workout there the way the real one would hold it:
    // with the marker after 011, without any such column before it.
    const weId = crypto.randomUUID();
    db.workouts.push({ id: mine.id, user_id: mine.userId, gym_id: mine.gymId || null, title: mine.title || null, performed_at: mine.performedAt, ended_at: mine.endedAt || null, calories: mine.calories ?? null, photo_path: null,
      workout_exercises: [{ id: weId, workout_id: mine.id, exercise_id: mine.exercises[0].exerciseId, order_index: 0, metric: "reps", equipment: mine.exercises[0].equipment || null, note: null, superset_group: null,
        workout_sets: sets.map((x, n) => ({ id: crypto.randomUUID(), workout_exercise_id: weId, set_number: n + 1, reps: x.reps, seconds: null, weight: x.weight, weight_unit: x.unit, distance: null, distance_unit: "mi", intensity: null, heart_rate: null, steps: null, ...(mode.legacy ? {} : { is_drop: Boolean(x.drop) }) })) }] });
    await page.reload(); await page.waitForTimeout(3000);
    st = await local(page);
    const again = st.workouts.find((w) => w.id === mine.id);
    check(T + "still marked after the next sync", !!again && again.exercises[0].sets[1].drop === true, JSON.stringify(again && again.exercises[0].sets));

    check(T + "no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  });
}

test("inbox: clear all", async ({ browser }) => {
  const { context, page, db, errors } = await open(browser);
  const T = "inbox: ";
  const badge = () => page.evaluate(() => { const b = document.getElementById("inbox-badge"); return b.hidden ? "" : b.textContent; });
  await page.click("#open-inbox"); await page.waitForTimeout(700);
  const before = await page.locator(".inbox-row").count();
  check(T + "activity is listed with a Clear all button", before >= 3 && await page.locator("[data-inbox-clear]").isVisible(), String(before));
  await page.screenshot({ path: `${SCREENS}/fix-inbox-clear.png` });
  await page.click("[data-inbox-clear]"); await page.waitForTimeout(400);
  const text = flat(await page.innerText("#list-modal-body"));
  check(T + "Clear all empties the activity", (await page.locator(".inbox-row").count()) === 0 && /Nothing else yet/.test(text) && /Inbox cleared/.test(await toast(page)), text);
  check(T + "a friend request is not cleared: it needs an answer", /Priya Rao/.test(text) && /Accept/.test(text));
  check(T + "the button goes away with the list", (await page.locator("[data-inbox-clear]").count()) === 0);
  check(T + "the bell counts only the request", (await badge()) === "1", await badge());
  await page.waitForTimeout(2200);
  check(T + "cleared on every phone (synced in settings)", !!db.profiles[0].settings.inboxClearedAt, JSON.stringify(db.profiles[0].settings).slice(0, 200));
  check(T + "a tag nobody answered is settled by clearing", db.profiles[0].settings.tagsDone && Object.keys(db.profiles[0].settings.tagsDone).length === 1, JSON.stringify(db.profiles[0].settings.tagsDone));

  await page.reload(); await page.waitForTimeout(2800);
  await page.click("#open-inbox"); await page.waitForTimeout(700);
  check(T + "stays cleared after reopening the app", (await page.locator(".inbox-row").count()) === 0);

  // something new still arrives
  db.reactions.push({ workout_id: db.workouts[0].id, user_id: db.profiles[2].id, emoji: "\u{1F44F}", created_at: new Date(Date.now() + 5000).toISOString() });
  await page.click("#list-modal-close"); await page.reload(); await page.waitForTimeout(2800);
  await page.click("#open-inbox"); await page.waitForTimeout(700);
  check(T + "new activity after clearing still shows up", (await page.locator(".inbox-row").count()) === 1 && /Dev Patel/.test(await page.innerText("#list-modal-body")), flat(await page.innerText("#list-modal-body")));
  check(T + "no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});

test("friends search with the keyboard up", async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  const T = "search: ";
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(500);
  await page.click("#friends-manage"); await page.waitForTimeout(500);
  await page.click("#friend-search"); await page.waitForTimeout(500);
  // what an iPhone keyboard does: covers the bottom 336px of the screen
  const KB = 336;
  await page.evaluate((kb) => { document.documentElement.style.setProperty("--kb", kb + "px"); document.body.classList.add("kb-open"); }, KB);
  await page.waitForTimeout(400);
  const box = async () => page.evaluate(() => {
    const r = document.getElementById("friend-search").getBoundingClientRect();
    const s = document.querySelector("#list-modal-overlay .modal-sheet").getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, sheetTop: s.top, sheetBottom: s.bottom };
  });
  let b = await box();
  check(T + "the sheet fits in the room above the keyboard", b.sheetTop >= 0 && b.sheetBottom <= 844 - KB + 1, JSON.stringify(b));
  check(T + "the search box is on screen, above the keyboard", b.top >= 0 && b.bottom <= 844 - KB, JSON.stringify(b));
  await page.fill("#friend-search", "sam"); await page.waitForTimeout(900);
  b = await box();
  check(T + "still visible with results showing", b.top >= 0 && b.bottom <= 844 - KB && (await page.inputValue("#friend-search")) === "sam", JSON.stringify(b));
  await page.screenshot({ path: `${SCREENS}/fix-friend-search.png` });
  // scroll the list: the box stays put
  await page.evaluate(() => { document.querySelector("#list-modal-overlay .modal-sheet").scrollTop = 400; });
  await page.waitForTimeout(300);
  b = await box();
  check(T + "it stays at the top while the list scrolls", b.top >= b.sheetTop - 1 && b.bottom <= 844 - KB, JSON.stringify(b));
  // the page pushed up under the status bar (what happened in the screenshot)
  await page.evaluate(() => { document.documentElement.style.setProperty("--vvtop", "120px"); document.querySelector("#list-modal-overlay .modal-sheet").scrollTop = 0; });
  await page.waitForTimeout(300);
  b = await box();
  check(T + "a page pushed up 120px: the sheet starts below what's hidden", b.sheetTop >= 120 && b.top >= 120, JSON.stringify(b));
  check(T + "no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});
