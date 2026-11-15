/**
 * Share card and weekly recap.
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import fs from "node:fs";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, ME, MAYA, DEV, G1, G2 } from "./support/supabase.js";

let browser;      // set by each test: the helpers below open their pages with it
const flat = (t) => t.replace(/\s+/g, " ").trim();
const EX = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", EXB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
// the real current week, Sunday 12:00 AM local
const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
const at = (dayOffset, hour) => { const d = new Date(weekStart); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); return d; };
const lift = (id, user, gym, when, title, ex, weights, mins = 60) => {
  const we = crypto.randomUUID();
  return { id, user_id: user, gym_id: gym, title, performed_at: when.toISOString(), ended_at: new Date(when.getTime() + mins * 60000).toISOString(), calories: null, photo_path: null,
    workout_exercises: [{ id: we, workout_id: id, exercise_id: ex, order_index: 0, metric: "reps", equipment: "Barbell", note: null, superset_group: null,
      workout_sets: weights.map((w, i) => ({ id: crypto.randomUUID(), workout_exercise_id: we, set_number: i + 1, reps: 5, seconds: null, weight: w, weight_unit: "lb", distance: null, distance_unit: "mi", intensity: null, heart_rate: null, steps: null })) }] };
};
const ID = (n) => `77777777-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
function seed(db, { emptyWeek = false } = {}) {
  db.workouts = [
    lift(ID(1), ME, G2, at(-10, 18), "Old Legs", EX, [185, 200]),                       // two weeks back: the record to beat
    ...(emptyWeek ? [] : [
      lift(ID(2), ME, G1, at(1, 18), "Leg Day", EX, [225, 245]),                         // Mon: record (245 > 200)
      lift(ID(3), ME, G1, at(3, 7), "Heavy Squats With A Very Long Title That Wraps", EX, [250], 45),   // Wed: record (250 > 245)
      lift(ID(4), ME, G2, at(5, 12), "Easy Day", EX, [135], 30),                         // Fri: no record
    ]),
    lift(ID(5), MAYA, G1, at(2, 9), "Push Day", EXB, [165, 175]),
    lift(ID(6), MAYA, G1, at(4, 9), "Pull Day", EXB, [100]),
    lift(ID(7), DEV, G1, at(1, 20), "Legs", EXB, [300]),
    lift(ID(8), MAYA, G1, at(8, 9), "This week, not last", EXB, [100]),                  // after the recap week
  ];
  db.comments = []; db.workout_tags = [{ workout_id: ID(2), user_id: MAYA, created_at: at(1, 19).toISOString() }]; db.presence = []; db.reactions = [];
}
async function open({ fake, signedIn = true, theme = "light", emptyWeek = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb();
  db.profiles[0].settings = { theme, customEquipment: [] };
  seed(db, { emptyWeek });
  await install(context, db); await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  const page = await context.newPage();
  if (fake) await page.clock.install({ time: fake });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_);
  await page.waitForTimeout(signedIn ? 2800 : 1000);
  return { context, page, db, errors };
}
const SUNDAY = at(7, 10), MONDAY = at(8, 9), TUESDAY = at(9, 9);
const pad = (n) => String(n).padStart(2, "0");
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sat = at(6, 0);
const LABEL = `${M[weekStart.getMonth()]} ${weekStart.getDate()} – ${sat.getMonth() === weekStart.getMonth() ? "" : M[sat.getMonth()] + " "}${sat.getDate()}`;
for (const theme of ["light", "dark"]) test(`Sunday: recap, then share a workout (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ fake: SUNDAY, theme });
  const T = theme + ": ";
  // ---------- recap card on Home ----------
  let card = flat(await page.innerText("#home-recap"));
  check(T + "Sunday: recap card for last week on Home", card === `YOUR WEEK · ${LABEL.toUpperCase()} 3 workouts · 4,275 lb · 2 records ×`, card + " | expected label " + LABEL);
  await page.screenshot({ path: `${SCREENS}/p3-${theme}-9-home-recap.png` });
  await page.click("#recap-open"); await page.waitForTimeout(400);
  let body = flat(await page.innerText("#list-modal-body"));
  check(T + "recap: the week's numbers", new RegExp(`^${LABEL} 3 WORKOUTS 4,275 VOLUME LB 2h 15m TRAINING TIME 2 RECORDS`, "i").test(body), body);
  check(T + "recap: both records named, measured against what came before", /2 new personal records Back Squat 245\s?lb Back Squat 250\s?lb/i.test(body), body);
  check(T + "recap: top gym", /Most at Planet Fitness \(2 visits\)/.test(body), body);
  check(T + "recap: friends ranked for the same week only", /FRIENDS LAST WEEK MJ Maya Jensen 2 workouts 2 DP Dev Patel 1 workout Done/i.test(body), body);
  await page.screenshot({ path: `${SCREENS}/p3-${theme}-10-recap.png` });
  await page.click("#recap-done"); await page.waitForTimeout(300);
  check(T + "opening it retires the Home card", await page.locator("#home-recap").isHidden());
  await page.waitForTimeout(1800);
  check(T + "…on every phone (synced)", /^\d{4}-\d+-\d+$/.test(db.profiles[0].settings.recapSeen || ""), db.profiles[0].settings.recapSeen);
  await page.click('[data-tab="profile"]'); await page.waitForTimeout(300);
  await page.click("#profile-recap"); await page.waitForTimeout(300);
  check(T + "always available from Profile", (await page.innerText("#list-modal-title")) === "Your week" && /3 WORKOUTS/i.test(flat(await page.innerText("#list-modal-body"))));
  await page.click("#recap-done");

  // ---------- share card ----------
  await page.click('[data-tab="home"]'); await page.waitForTimeout(300);
  await page.goto(URL_ + "?workout=" + ID(3)); await page.waitForTimeout(2800);
  body = (await page.locator("#list-modal-overlay.open").count()) ? flat(await page.innerText("#list-modal-body")) : "";
  check(T + "my workout offers Share as a picture", /Share as a picture/.test(body), body.slice(0, 200));
  await page.click("#detail-share"); await page.waitForSelector("#share-img", { timeout: 15000 });
  const info = await page.evaluate(async () => {
    const img = document.getElementById("share-img");
    if (!img.complete) await new Promise((r) => { img.onload = r; });
    const blob = await (await fetch(img.src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    // sample a few pixels: the card must not be blank
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const px = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data).join(",");
    const colors = new Set(); for (let Y = 100; Y < 1900; Y += 60) for (let X = 90; X < 1000; X += 70) colors.add(px(X, Y));
    return { w: img.naturalWidth, h: img.naturalHeight, type: blob.type, size: blob.size, colors: colors.size, b64: btoa(bin),
      save: document.getElementById("share-save").getAttribute("download"), hasShare: !!document.getElementById("share-go") };
  });
  fs.writeFileSync(`${SCREENS}/p3-card-${theme}.png`, Buffer.from(info.b64, "base64"));
  check(T + "card is a 1080×1920 PNG with real content", info.w === 1080 && info.h === 1920 && info.type === "image/png" && info.size > 40000 && info.colors > 40, JSON.stringify({ ...info, b64: undefined }));
  check(T + "Save picture has a sensible file name", info.save === "gymsocial-heavy-squats-with-a-very-long-title-that-wraps.png", info.save);
  await page.screenshot({ path: `${SCREENS}/p3-${theme}-11-share.png` });
  await page.click("#list-modal-close");
  // a friend's workout is theirs to share, not mine
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(400);
  await page.locator(".friend-open").first().click(); await page.waitForTimeout(300);
  check(T + "no Share on a friend's workout", (await page.locator("#detail-share").count()) === 0);
  await page.click("#list-modal-close");
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
// ---------- Monday still shows it; dismiss; Tuesday doesn't ----------
test("Monday still shows it; dismiss; Tuesday doesn't", async ({ browser: b }) => {
  browser = b;
  const { context, page, db } = await open({ fake: MONDAY });
  check("Monday: card still there", /3 workouts/.test(await page.innerText("#home-recap")));
  await page.click("#recap-x"); await page.waitForTimeout(300);
  check("× dismisses it without opening", await page.locator("#home-recap").isHidden() && (await page.locator("#list-modal-overlay.open").count()) === 0);
  await page.reload(); await page.waitForTimeout(2800);
  check("…and it stays dismissed", await page.locator("#home-recap").isHidden());
  await context.close();
});
test("Tuesday: no card on Home, but the notification link still opens the recap", async ({ browser: b }) => {
  browser = b;
  const { context, page } = await open({ fake: TUESDAY });
  check("Tuesday: no card on Home", await page.locator("#home-recap").isHidden());
  await page.goto(URL_ + "?recap=1"); await page.waitForTimeout(2800);
  check("the recap notification link opens it any day", (await page.innerText("#list-modal-title")) === "Your week" && (await page.locator("#list-modal-overlay.open").count()) === 1);
  await context.close();
});
// ---------- a week with no workouts of mine ----------
test("A week with no workouts of mine", async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open({ fake: SUNDAY, emptyWeek: true });
  const card = flat(await page.innerText("#home-recap"));
  check("empty week: card points at friends instead", /See how your friends’ week went/.test(card), card);
  await page.click("#recap-open"); await page.waitForTimeout(300);
  const body = flat(await page.innerText("#list-modal-body"));
  check("empty week: says so, still shows friends", /No workouts last week\. This one is a clean slate\./.test(body) && /Maya Jensen 2 workouts/.test(body), body);
  check("empty week: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
// ---------- signed out ----------
test("Signed out", async ({ browser: b }) => {
  browser = b;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb(); await install(context, db); await installMaps(context, db);
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(URL_); await page.waitForTimeout(900);
  // log one workout without an account, then share it
  await page.click('[data-tab="log"]'); await page.waitForTimeout(200);
  await page.fill("#log-title", "Solo Session");
  await page.click("#add-exercise-btn"); await page.waitForTimeout(300);
  await page.locator("#exercise-modal-list").locator("button, [data-ex], .picker-row, div").filter({ hasText: /^Back Squat/ }).first().click(); await page.waitForTimeout(400);
  if (await page.locator("#exercise-modal-overlay.open").count()) await page.locator("#exercise-modal-list").locator("button, div").filter({ hasText: /Barbell/ }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const inputs = page.locator("#exercise-blocks input");
  await inputs.nth(0).fill("5"); await inputs.nth(1).fill("225");
  await page.click("#save-workout-btn"); await page.waitForTimeout(700);
  const saved = /Share as a picture/.test(await page.innerText("#list-modal-body").catch(() => ""));
  check("signed out: the after-save summary offers Share", saved, await page.innerText("#toast"));
  if (saved) {
    await page.click("#summary-share"); await page.waitForSelector("#share-img", { timeout: 15000 });
    const dim = await page.evaluate(async () => { const i = document.getElementById("share-img"); if (!i.complete) await new Promise((r) => { i.onload = r; }); return i.naturalWidth + "x" + i.naturalHeight; });
    check("signed out: card made without an account", dim === "1080x1920", dim);
    const b64 = await page.evaluate(async () => { const b = new Uint8Array(await (await fetch(document.getElementById("share-img").src)).arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); });
    fs.writeFileSync(SCREENS + "/p3-card-signedout.png", Buffer.from(b64, "base64"));
  }
  check("signed out: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
