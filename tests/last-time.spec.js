/**
 * "Last time" on the Log screen: it follows the equipment you pick, it finds
 * an exercise that exists twice under slightly different names, and Incline
 * Bench is no longer folded into Incline Press. Run with: npm test
 */
import { test } from "@playwright/test";
import { check, URL_ } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, ME, G2 } from "./support/supabase.js";

const flat = (t) => t.replace(/\s+/g, " ").trim();
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().replace("Z", "+00:00");

const CURL = "c0000000-0000-4000-8000-000000000001";
const CURLS = "c0000000-0000-4000-8000-000000000002";      // the same lift, saved again as "Bicep Curls"
const INC_PRESS = "c0000000-0000-4000-8000-000000000003";
const INC_BENCH = "c0000000-0000-4000-8000-000000000004";

function session(id, days, exerciseId, equipment, weight) {
  const weId = crypto.randomUUID();
  return { id, user_id: ME, gym_id: G2, title: null, performed_at: ago(days), ended_at: null, calories: null, photo_path: null,
    workout_exercises: [{ id: weId, workout_id: id, exercise_id: exerciseId, order_index: 0, metric: "reps", equipment, note: null, superset_group: null,
      workout_sets: [{ id: crypto.randomUUID(), workout_exercise_id: weId, set_number: 1, reps: 10, seconds: null, weight, weight_unit: "lb",
        distance: null, distance_unit: "mi", intensity: null, heart_rate: null, steps: null, is_drop: false }] }] };
}

async function open(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb();
  db.exercises.push(
    { id: CURL, owner_id: ME, name: "Bicep Curl", category: "pull", metric: "reps" },
    { id: CURLS, owner_id: ME, name: "Bicep Curls", category: "pull", metric: "reps" },
    { id: INC_PRESS, owner_id: ME, name: "Incline Press", category: "push", metric: "reps" },
    { id: INC_BENCH, owner_id: ME, name: "Incline Bench", category: "push", metric: "reps" },
  );
  db.workouts.push(
    session("d0000000-0000-4000-8000-000000000001", 20, CURL, null, 20),          // before equipment was recorded
    session("d0000000-0000-4000-8000-000000000002", 9, CURL, "Dumbbell", 30),
    session("d0000000-0000-4000-8000-000000000003", 4, CURLS, "Cable", 50),      // newest, under the other spelling
    session("d0000000-0000-4000-8000-000000000004", 6, INC_PRESS, "Dumbbell", 60),
  );
  await install(context, db); await installMaps(context, db);
  await context.addInitScript(sessionScript());
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_);
  await page.waitForTimeout(2800);
  return { context, page, db, errors };
}

async function pick(page, search, id) {
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  await page.click("#add-exercise-btn"); await page.waitForTimeout(300);
  await page.fill("#exercise-search", search); await page.waitForTimeout(300);
  await page.click('[data-pick-ex="' + id + '"]'); await page.waitForTimeout(500);
}

const lastLine = (page, i = 0) => page.locator("#exercise-blocks .last-time").nth(i).innerText().then(flat);
const equip = async (page, name, i = 0) => { await page.locator('#exercise-blocks [data-equip="' + i + ':' + name + '"]').click(); await page.waitForTimeout(400); };

test("last time: follows the equipment and finds both spellings", async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  await pick(page, "bicep curl", CURL);
  let line = await lastLine(page);
  check("not 'first time' when it was logged under the other spelling", /^Last time on Cable 10 @ 50lb/.test(line), line);
  check("the first set is filled from that session", (await page.locator("#exercise-blocks .set-row input").nth(1).inputValue()) === "50");

  await equip(page, "Dumbbell");
  line = await lastLine(page);
  check("Dumbbell: last time shows the dumbbell weight", /^Last time on Dumbbell 10 @ 30lb/.test(line), line);
  check("Dumbbell: the suggestion follows", (await page.locator("#exercise-blocks .set-row input").nth(1).inputValue()) === "30");

  await equip(page, "Cable");
  line = await lastLine(page);
  check("Cable: back to the cable weight", /^Last time on Cable 10 @ 50lb/.test(line), line);

  await equip(page, "Machine");
  line = await lastLine(page);
  check("never done on Machine: falls back to the session with no equipment recorded", /^Last time on Machine 10 @ 20lb/.test(line), line);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});

test("last time: first time on new equipment, and Incline Bench is its own lift", async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  await pick(page, "incline bench", INC_BENCH);
  let line = await lastLine(page);
  check("Incline Bench doesn't borrow Incline Press's history", /^First time logging this/.test(line), line);

  await page.click("#add-exercise-btn"); await page.waitForTimeout(300);
  await page.fill("#exercise-search", "dumbbell incline bench"); await page.waitForTimeout(400);
  const row = flat(await page.locator("[data-pick-parsed]").innerText());
  check("typing 'dumbbell incline bench' logs as Incline Bench, not Incline Press", /Logs as Incline Bench with Dumbbell/.test(row), row);
  await page.click("#exercise-modal-close").catch(() => {}); await page.waitForTimeout(300);

  await pick(page, "incline press", INC_PRESS);
  line = await lastLine(page, 1);
  check("Incline Press keeps its own history", /^Last time on Dumbbell 10 @ 60lb/.test(line), line);
  await equip(page, "Barbell", 1);
  line = await lastLine(page, 1);
  check("a lift never done on Barbell says so", /^First time on Barbell/.test(line), line);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});
