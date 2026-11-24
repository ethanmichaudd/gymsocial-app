/**
 * Goals and estimated 1RM.
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript } from "./support/supabase.js";

let browser;      // set by each test: the helpers below open their pages with it

const flat = (t) => t.replace(/\s+/g, " ").trim();
const toast = (page) => page.innerText("#toast");

async function open({ signedIn = true, theme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb();
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

/* Logs one set of an exercise through the real Log screen and saves it. */
async function logSet(page, exercise, reps, weight) {
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  await page.click("#add-exercise-btn"); await page.waitForTimeout(300);
  await page.fill("#exercise-search", exercise); await page.waitForTimeout(300);
  await page.locator("#exercise-modal-list").locator("button, [data-ex], .picker-row, div").filter({ hasText: new RegExp("^" + exercise, "i") }).first().click();
  await page.waitForTimeout(400);
  if (await page.locator("#exercise-modal-overlay.open").count()) {
    await page.locator("#exercise-modal-list").locator("button, div").filter({ hasText: /Barbell|Cable|Machine/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const inputs = page.locator("#exercise-blocks input");
  await inputs.nth(0).fill(String(reps));
  await inputs.nth(1).fill(String(weight));
}

for (const theme of ["light", "dark"]) test(`Signed in (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ theme });
  const T = theme + ": ";

  // the base data has one workout of mine: Back Squat 5 x 225, 5 x 245  ->  245 x (1 + 5/30) = 285.8
  await page.click('[data-tab="profile"]'); await page.waitForTimeout(300);
  check(T + "Profile row names goals", /Progress and goals/.test(await page.innerText("#profile-progress")));
  await page.click("#profile-progress"); await page.waitForTimeout(300);
  let card = flat(await page.innerText("#goals-card"));
  check(T + "Goals card: weekly target first, then an invitation", /^GOALS This week \d of 3 workouts .*Change Pick a lift and a number to chase\..*estimated 1RM.*\+ Add a strength goal$/i.test(card), card);
  check(T + "exercise card shows the estimate next to the best set", /Best logged: 245\s?lb Estimated 1RM: 286 lb/.test(flat(await page.innerText("#progress-body"))), flat(await page.innerText("#progress-body")).slice(0, 160));

  // ---- set a goal ----
  await page.click("#goal-add"); await page.waitForTimeout(300);
  check(T + "sheet explains where the number comes from", /^Estimated 1RM now: 286 lb \(best set 245 lb × 5, \d+\/\d+\)$/.test(await page.innerText("#goal-now")), await page.innerText("#goal-now"));
  check(T + "a first target is suggested, a little above, on a round number", (await page.inputValue("#goal-target")) === "305", await page.inputValue("#goal-target"));
  await page.fill("#goal-target", "280"); await page.click("#goal-save"); await page.waitForTimeout(200);
  check(T + "a goal you've already passed is refused", /already at 286 lb/.test(await toast(page)) && (await page.locator("#list-modal-overlay.open").count()) === 1, await toast(page));
  await page.fill("#goal-target", "315"); await page.click("#goal-save"); await page.waitForTimeout(300);
  card = flat(await page.innerText("#goals-card"));
  check(T + "goal row: now, target, what's left", /Back Squat 286 → 315 lb 29 lb to go · best set 245 lb × 5/.test(card), card);
  check(T + "progress bar starts empty and is named for screen readers", (await page.getAttribute('[data-goal] .goal-bar', "aria-valuenow")) === "0" && /Back Squat: estimated one-rep max 286 lb of 315 lb/.test(await page.getAttribute('[data-goal] .goal-bar', "aria-label")));
  await page.screenshot({ path: `${SCREENS}/p4-${theme}-goals.png` });
  await page.waitForTimeout(2000);
  const saved = db.profiles[0].settings.goals;
  check(T + "goal syncs with the account (no database change needed)", Array.isArray(saved) && saved.length === 1 && saved[0].target === 315 && saved[0].unit === "lb" && saved[0].name === "Back Squat", JSON.stringify(saved));
  await page.click("#progress-done");

  // ---- reach it ----
  await logSet(page, "Back Squat", 3, 290);          // 290 x (1 + 3/30) = 319
  await page.click("#finish-workout-btn"); await page.waitForTimeout(250); if (await page.locator("#time-overlay.open").count()) { await page.click("#time-ok"); await page.waitForTimeout(250); } await page.click("#save-workout-btn"); await page.waitForTimeout(900);
  if (await page.locator("#confirm-overlay.open").count()) await page.click("#confirm-no");
  const summary = flat(await page.innerText("#list-modal-body"));
  check(T + "the after-save sheet says the goal was reached", /Goal reached Back Squat 315 lb estimated 1RM/i.test(summary), summary.slice(0, 260));
  await page.screenshot({ path: `${SCREENS}/p4-${theme}-goal-reached.png` });
  await page.click("#summary-done");
  await page.click('[data-tab="profile"]'); await page.click("#profile-progress"); await page.waitForTimeout(300);
  card = flat(await page.innerText("#goals-card"));
  check(T + "goal row shows it as reached, bar full", /Back Squat 319 → 315 lb Reached \d+\/\d+/.test(card) && (await page.locator("[data-goal].is-reached .goal-bar.is-done").count()) === 1, card);

  // ---- raise it, then remove it ----
  await page.click("[data-goal]"); await page.waitForTimeout(300);
  check(T + "tapping a goal edits it", (await page.innerText("#list-modal-title")) === "Edit goal" && (await page.inputValue("#goal-target")) === "315");
  await page.fill("#goal-target", "350"); await page.click("#goal-save"); await page.waitForTimeout(300);
  card = flat(await page.innerText("#goals-card"));
  check(T + "raising the target puts it back in progress", /Back Squat 319 → 350 lb 31 lb to go/.test(card) && (await page.locator("[data-goal].is-reached").count()) === 0, card);
  await page.click("[data-goal]"); await page.waitForTimeout(300);
  await page.click("#goal-remove"); await page.waitForTimeout(300);
  check(T + "a goal can be removed", (await page.locator("[data-goal]").count()) === 0 && /Goal removed/.test(await toast(page)));
  await page.click("#progress-done");

  // ---- weight unit ----
  await page.click("#open-settings"); await page.waitForTimeout(300);
  check(T + "Settings: pounds by default", (await page.locator('[data-unit-set="lb"].selected').count()) === 1);
  await page.click('[data-unit-set="kg"]'); await page.waitForTimeout(300);
  check(T + "Settings: switched to kilograms", (await page.locator('[data-unit-set="kg"].selected').count()) === 1);
  await page.click("#open-settings");
  await logSet(page, "Lat Pulldown", 8, 60);
  check(T + "a lift you've never logged starts in kg", (await page.locator("#exercise-blocks [data-unit-toggle]").first().innerText()).trim() === "kg", await page.locator("#exercise-blocks [data-unit-toggle]").first().innerText());
  await page.click("#log-cancel"); await page.waitForTimeout(200);
  if (await page.locator("#confirm-overlay.open").count()) await page.click("#confirm-yes");
  await page.click('[data-tab="profile"]'); await page.click("#profile-progress"); await page.waitForTimeout(300);
  await page.click("#goal-add"); await page.waitForTimeout(300);
  check(T + "goals follow the unit: pounds logged, shown in kg", /Estimated 1RM now: 144\.5 kg \(best set 290 lb × 3/.test(await page.innerText("#goal-now")) && /\(kg\)/i.test(await page.innerText('label[for="goal-target"]')), await page.innerText("#goal-now"));
  await page.click("#list-modal-close");
  await page.waitForTimeout(1800);
  check(T + "unit choice syncs", db.profiles[0].settings.unit === "kg", db.profiles[0].settings.unit);
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Signed out", async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open({ signedIn: false });
  await page.click('#profile-stats [data-stat="progress"]'); await page.waitForTimeout(300);
  const card = flat(await page.innerText("#goals-card"));
  check("signed out: Goals card is there, with the weekly target", /^GOALS This week 0 of 3 workouts/i.test(card), card);
  await page.click("#goal-add"); await page.waitForTimeout(300);
  check("signed out: nothing logged yet -> says what to do first", /Log a lift with weight first/.test(await page.innerText("#list-modal-body")));
  await page.click("#list-modal-close");
  await page.click("#progress-done");
  await logSet(page, "Back Squat", 5, 200);
  await page.click("#finish-workout-btn"); await page.waitForTimeout(250); if (await page.locator("#time-overlay.open").count()) { await page.click("#time-ok"); await page.waitForTimeout(250); } await page.click("#save-workout-btn"); await page.waitForTimeout(700);
  await page.click("#summary-done");
  await page.click('#profile-stats [data-stat="progress"]'); await page.waitForTimeout(300);
  await page.click("#goal-add"); await page.waitForTimeout(300);
  await page.click("#goal-save"); await page.waitForTimeout(300);
  check("signed out: a goal works without an account", /Back Squat 233 → 250 lb 17 lb to go/.test(flat(await page.innerText("#goals-card"))), flat(await page.innerText("#goals-card")));
  check("signed out: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
