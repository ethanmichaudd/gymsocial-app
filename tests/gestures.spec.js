/**
 * Gestures and the Finish sheet.
 *
 * - swipe a sheet down to close it
 * - swipe an exercise in any workout left (or ⋯) for Add to workout / Edit
 * - reorder exercises on the log screen: drag the ≡ handle, or ⋯ -> Move
 * - Finish workout: photo and calories live in a sheet at the end
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, W1, W2 } from "./support/supabase.js";

let browser;
async function open({ signedIn = true, theme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb();
  db.profiles[0].settings = { theme, customEquipment: [] };
  await install(context, db); await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_);
  await page.waitForTimeout(signedIn ? 2600 : 1000);
  return { context, page, db, errors };
}
const shot = (page, name) => page.screenshot({ path: `${SCREENS}/${name}.png` });
const flat = (t) => t.replace(/\s+/g, " ").trim();
const isOpen = (page, id) => page.evaluate((x) => document.getElementById(x).classList.contains("open"), id);
const names = (page) => page.$$eval("#exercise-blocks .exercise-block .ex-name", (els) => els.map((e) => e.textContent.replace("✎", "").trim()));

/* a finger drag, as touch events: (x0, y0) -> (x1, y1) */
async function swipe(page, selector, dx, dy) {
  const box = await page.locator(selector).first().boundingBox();
  const x0 = box.x + box.width * 0.7, y0 = box.y + Math.min(20, box.height / 2);
  await page.evaluate(({ sel, x0, y0, dx, dy }) => {
    const el = document.querySelector(sel);
    const t = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [t(x0, y0)], changedTouches: [t(x0, y0)] }));
    for (let i = 1; i <= 8; i++) {
      const x = x0 + (dx * i) / 8, y = y0 + (dy * i) / 8;
      el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t(x, y)], changedTouches: [t(x, y)] }));
    }
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [t(x0 + dx, y0 + dy)] }));
  }, { sel: selector, x0, y0, dx, dy });
  await page.waitForTimeout(550);   // past the moment a phone's after-swipe click is ignored
}

async function addExercise(page, name) {
  await page.click("#add-exercise-btn"); await page.waitForTimeout(250);
  await page.fill("#exercise-search", name); await page.waitForTimeout(250);
  await page.locator("#exercise-modal-list .picker-row").filter({ hasText: new RegExp("^" + name, "i") }).first().click();
  await page.waitForTimeout(300);
}

for (const theme of ["light", "dark"]) test(`Gestures and Finish (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ theme });
  const T = theme + ": ";

  // ---------- swipe a sheet down to close it ----------
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(500);
  await page.click("#feed-board"); await page.waitForTimeout(300);
  check(T + "sheet has a grab bar", await page.evaluate(() => getComputedStyle(document.querySelector("#list-modal-overlay .modal-sheet"), "::before").content !== "none"));
  await swipe(page, "#list-modal-overlay .modal-head", 0, 40);
  check(T + "a small pull springs back", await isOpen(page, "list-modal-overlay"));
  await swipe(page, "#list-modal-overlay .modal-head", 0, 320);
  check(T + "pulling it down closes it", !(await isOpen(page, "list-modal-overlay")));

  // ---------- a friend's exercise into my workout ----------
  await page.locator(".feed-card .feed-body").first().click(); await page.waitForTimeout(400);
  check(T + "friend's workout: each exercise has ⋯", (await page.locator("#list-modal-body .swipe-row [data-swipe-more]").count()) === 1);
  await swipe(page, "#list-modal-body .swipe-front", -180, 4);
  check(T + "swiping left shows Add to workout (no Edit on a friend's)", (await page.locator("#list-modal-body .swipe-row.is-open").count()) === 1 && (await page.locator("#list-modal-body [data-ex-edit]").count()) === 0);
  await shot(page, `gest-${theme}-1-swipe`);
  await swipe(page, "#list-modal-body .swipe-front", 180, 4);
  check(T + "swiping right hides it again", (await page.locator("#list-modal-body .swipe-row.is-open").count()) === 0);
  await page.click("#list-modal-body [data-swipe-more]"); await page.waitForTimeout(250);
  check(T + "⋯ opens it too", (await page.locator("#list-modal-body .swipe-row.is-open").count()) === 1);
  await page.click("#list-modal-body [data-ex-add]"); await page.waitForTimeout(400);
  check(T + "added, with a note, and the sheet stays open", /Added Bench Press to your workout/.test(await page.innerText("#toast")) && (await isOpen(page, "list-modal-overlay")));
  await page.click("#list-modal-close");
  await page.click('[data-tab="log"]'); await page.waitForTimeout(400);
  let r = await page.evaluate(() => { const b = document.querySelector("#exercise-blocks .exercise-block"); return { n: document.querySelectorAll("#exercise-blocks .exercise-block").length, eq: (b.querySelector(".equip-btn.selected") || {}).textContent, v: b.querySelector(".set-v2").value, light: !!b.querySelector(".is-prefill") }; });
  check(T + "it's on the log screen with her numbers as suggestions", r.n === 1 && r.eq === "Barbell" && r.v === "225" && r.light, JSON.stringify(r));

  // ---------- reorder ----------
  await addExercise(page, "Back Squat");
  await addExercise(page, "Deadlift");
  check(T + "three exercises in order", (await names(page)).join(",") === "Bench Press,Back Squat,Deadlift", (await names(page)).join(","));
  await page.locator('#exercise-blocks [data-ex-menu="0"]').click(); await page.waitForTimeout(250);
  check(T + "⋯ menu: Move up off for the first", await page.locator('[data-menu="up"]').isDisabled());
  await page.click('[data-menu="down"]'); await page.waitForTimeout(300);
  check(T + "Move down", (await names(page)).join(",") === "Back Squat,Bench Press,Deadlift", (await names(page)).join(","));
  // drag Deadlift (3rd) up one place by its handle
  await page.locator('#exercise-blocks [data-drag="2"]').scrollIntoViewIfNeeded();
  const h = await page.locator('#exercise-blocks [data-drag="2"]').boundingBox();
  const prev = await page.locator("#exercise-blocks .exercise-block").nth(1).boundingBox();
  const lift = prev.height * 0.8;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 - (lift * i) / 12); await page.waitForTimeout(16); }
  await shot(page, `gest-${theme}-2-drag`);
  await page.mouse.up(); await page.waitForTimeout(400);
  check(T + "dragging the handle reorders", (await names(page)).join(",") === "Back Squat,Deadlift,Bench Press", (await names(page)).join(","));
  await page.locator('#exercise-blocks [data-ex-menu="2"]').click(); await page.waitForTimeout(250);
  await page.click('[data-menu="dup"]'); await page.waitForTimeout(300);
  check(T + "Duplicate", (await names(page)).join(",") === "Back Squat,Deadlift,Bench Press,Bench Press", (await names(page)).join(","));
  await page.locator('#exercise-blocks [data-ex-menu="3"]').click(); await page.waitForTimeout(250);
  await page.click('[data-menu="remove"]'); await page.waitForTimeout(300);
  check(T + "Remove", (await names(page)).join(",") === "Back Squat,Deadlift,Bench Press", (await names(page)).join(","));

  // ---------- Finish workout ----------
  check(T + "photo and calories are gone from the log screen", !(await page.locator("#screen-log #log-calories").count()) && !(await page.locator("#screen-log #log-photo").count()));
  check(T + "the button says Finish workout", /Finish workout/i.test(await page.innerText("#finish-workout-btn")));
  await page.fill("#log-title", "Pull Day");
  const blocks = page.locator("#exercise-blocks .exercise-block");
  for (let i = 0; i < 3; i++) { await blocks.nth(i).locator(".set-v1").first().fill("5"); await blocks.nth(i).locator(".set-v2").first().fill("200"); }
  await page.click("#finish-workout-btn"); await page.waitForTimeout(350);
  // started a moment ago: under ten minutes, so it asks
  check(T + "a short workout asks about its times first", (await isOpen(page, "time-overlay")) && /Under a minute\?|Only \d+ minutes?\?/.test(await page.innerText("#time-title")) && !(await isOpen(page, "finish-overlay")), await page.innerText("#time-title"));
  await shot(page, `gest-${theme}-3a-times`);
  await page.evaluate(() => {
    const e = document.getElementById("time-end").value.split(":").map(Number);
    const m = (e[0] * 60 + e[1] - 50 + 1440) % 1440;
    document.getElementById("time-start").value = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  });
  await page.click("#time-save"); await page.waitForTimeout(350);
  const sum = flat(await page.innerText("#finish-summary"));
  check(T + "Save times: on to Finish with the new length", (await isOpen(page, "finish-overlay")) && /· 50m Edit/.test(sum), sum);
  check(T + "and the log screen's Start box changed too", (await page.inputValue("#log-start")) === (await page.inputValue("#time-start")));
  check(T + "Finish sheet: title, times, what's in it", /^Pull Day .* · \d{1,2}:\d\d [AP]M .*3 exercises · 4 sets$/.test(sum), sum);
  check(T + "photo and calories are in the sheet", (await page.locator("#finish-overlay #log-photo").count()) === 1 && (await page.locator("#finish-overlay #log-calories").count()) === 1);
  await shot(page, `gest-${theme}-3-finish`);
  await page.click("#finish-close"); await page.waitForTimeout(250);
  check(T + "Not yet goes back, nothing saved", !(await isOpen(page, "finish-overlay")) && (await names(page)).length === 3);
  await page.click("#finish-workout-btn"); await page.waitForTimeout(300);
  check(T + "asked once: the second Finish goes straight to the sheet", (await isOpen(page, "finish-overlay")) && !(await isOpen(page, "time-overlay")));
  await page.fill("#log-calories", "410");
  await page.click("#save-workout-btn"); await page.waitForTimeout(1500);
  const up = db.log.filter((l) => l.method === "POST" && l.path.endsWith("/workouts")).pop();
  check(T + "saved with its calories", !!up && up.body.calories === 410 && up.body.title === "Pull Day", up && JSON.stringify(up.body).slice(0, 200));
  check(T + "sheet closed, summary shown", !(await isOpen(page, "finish-overlay")));
  await page.click("#list-modal-close").catch(() => {});

  // ---------- my own workout: Edit goes straight to that exercise ----------
  await page.click('[data-tab="profile"]'); await page.waitForTimeout(400);
  await page.locator(`[data-open-row="${W1}"]`).click(); await page.waitForTimeout(400);
  await page.click("#list-modal-body [data-swipe-more]"); await page.waitForTimeout(250);
  check(T + "my workout: Add and Edit", (await page.locator("#list-modal-body [data-ex-edit]").count()) === 1 && (await page.locator("#list-modal-body [data-ex-add]").count()) === 1);
  await page.click("#list-modal-body [data-ex-edit]"); await page.waitForTimeout(500);
  check(T + "Edit opens the workout's editor at that exercise", (await isOpen(page, "edit-modal-overlay")) && (await page.locator("#edit-exercise-blocks .exercise-block.is-flash").count()) === 1);
  await swipe(page, "#edit-exercise-blocks .exercise-block .metric-switch", 0, 320);
  check(T + "the editor doesn't close from a pull in the middle", await isOpen(page, "edit-modal-overlay"));
  await page.click("#edit-modal-close");

  // ---------- empty ----------
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  await page.click("#finish-workout-btn"); await page.waitForTimeout(250);
  check(T + "Finish with nothing logged: a note, no sheet", /Add at least one exercise/.test(await page.innerText("#toast")) && !(await isOpen(page, "finish-overlay")));
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Gestures signed out", async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open({ signedIn: false });
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  await addExercise(page, "Back Squat");
  await page.locator("#exercise-blocks .set-v1").first().fill("5");
  await page.click("#finish-workout-btn"); await page.waitForTimeout(300);
  await page.click("#time-ok"); await page.waitForTimeout(300);
  check("signed out: It's right goes on to Finish", !(await isOpen(page, "time-overlay")));
  check("signed out: Finish sheet opens, photo asks to sign in", (await isOpen(page, "finish-overlay")) && /Sign in/i.test(await page.innerText("#log-photo")));
  await swipe(page, "#finish-overlay .modal-head", 0, 320);
  check("signed out: Finish sheet pulls down to close", !(await isOpen(page, "finish-overlay")));
  check("signed out: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Inbox: swipe an item left to delete it", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open();
  await page.click("#open-inbox"); await page.waitForTimeout(800);
  const before = await page.locator("#list-modal-body .inbox-swipe").count();
  const first = flat(await page.locator("#list-modal-body .inbox-swipe").first().innerText());
  await swipe(page, "#list-modal-body .inbox-swipe .swipe-front", -160, 3);
  check("swipe shows Delete", (await page.locator("#list-modal-body .inbox-swipe.is-open [data-inbox-del]").count()) === 1);
  await shot(page, "gest-inbox-swipe");
  await page.click("#list-modal-body .inbox-swipe.is-open [data-inbox-del]"); await page.waitForTimeout(600);
  const after = await page.locator("#list-modal-body .inbox-swipe").count();
  const nowFirst = flat(await page.locator("#list-modal-body .inbox-swipe").first().innerText().catch(() => ""));
  check("that one item is gone, the rest stay", after === before - 1 && nowFirst !== first, before + " -> " + after);
  check("the sheet stays open", await isOpen(page, "list-modal-overlay"));
  await page.waitForTimeout(1800);
  const pushed = db.log.filter((l) => l.method === "PATCH" && l.path.endsWith("/profiles")).pop();
  check("remembered in settings, so other phones hide it too", !!(pushed && pushed.body.settings && (pushed.body.settings.inboxHidden || []).length === 1));
  // tapping a row (no swipe) still opens it
  await page.locator("#list-modal-body .inbox-row[data-inbox-wk]").first().click(); await page.waitForTimeout(400);
  check("a plain tap still opens the workout", (await page.innerText("#list-modal-title")) === "Workout");
  await page.click("#list-modal-close");
  // reopen the app: still gone
  await page.reload(); await page.waitForTimeout(2600);
  await page.click("#open-inbox"); await page.waitForTimeout(800);
  check("still gone after reopening", (await page.locator("#list-modal-body .inbox-swipe").count()) === before - 1);
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Times check: a run logged afterwards", async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open();
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  await page.click('#log-kind [data-kind="cardio"]'); await page.waitForTimeout(300);
  await page.fill(".is-cardio .c-m", "25"); await page.fill(".is-cardio .c-s", "30"); await page.fill(".is-cardio .c-dist", "3.1");
  await page.click("#finish-workout-btn"); await page.waitForTimeout(300);
  const fill = await page.innerText("#time-fill");
  check("offers to use the run's own time", /Use 25:30 from your run/.test(fill), fill);
  const end = await page.inputValue("#time-end");
  await page.click("#time-fill"); await page.waitForTimeout(150);
  const start = await page.inputValue("#time-start");
  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const diff = (mins(end) - mins(start) + 1440) % 1440;
  check("start = finish − 25:30 (to the minute)", diff === 25 || diff === 26, start + " → " + end);
  await page.click("#time-save"); await page.waitForTimeout(300);
  check("on to Finish, now 25 minutes long", /· 2[56]m Edit/.test(flat(await page.innerText("#finish-summary"))), flat(await page.innerText("#finish-summary")));
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("A new sheet opens at the top", async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open();
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(500);
  await page.locator(".feed-card .feed-body").first().click(); await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector("#list-modal-overlay .modal-sheet").scrollTop = 400; });
  const was = await page.evaluate(() => document.querySelector("#list-modal-overlay .modal-sheet").scrollTop);
  await page.click("#list-modal-body .detail-who"); await page.waitForTimeout(400);
  check("opening their profile from a scrolled workout starts at the top", was > 0 && (await page.evaluate(() => document.querySelector("#list-modal-overlay .modal-sheet").scrollTop)) === 0, String(was));
  await page.click("#list-modal-close"); await page.waitForTimeout(200);
  await page.click("#feed-board"); await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelector("#list-modal-overlay .modal-sheet").scrollTop = 120; });
  const before = await page.evaluate(() => document.querySelector("#list-modal-overlay .modal-sheet").scrollTop);
  await page.click('[data-board="time"]'); await page.waitForTimeout(300);
  check("switching a leaderboard tab keeps your place", (await page.evaluate(() => document.querySelector("#list-modal-overlay .modal-sheet").scrollTop)) === before);
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
