/**
 * At the gym now, regulars.
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import fs from "node:fs";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, ME, MAYA, DEV, G1, G2, W1, W2 } from "./support/supabase.js";

let browser;      // set by each test: the helpers below open their pages with it
const bare = (id, user, gym, minsAgo, title) => ({ id, user_id: user, gym_id: gym, title, performed_at: new Date(Date.now() - minsAgo * 60000).toISOString(), ended_at: null, calories: null, photo_path: null, workout_exercises: [] });
async function open({ signedIn = true, legacy9 = false, theme = "light", tweak } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb({ legacy9 });
  db.profiles[0].settings = { theme, customEquipment: [] };
  // this month at Planet Fitness: me 5, Dev 2, Maya 1 (from the base data)
  for (let i = 0; i < 5; i++) db.workouts.push(bare(`bbbbbbbb-0000-4000-8000-00000000000${i}`, ME, G1, 5 + i, "Lift " + i));
  for (let i = 0; i < 2; i++) db.workouts.push(bare(`dddddddd-0000-4000-8000-00000000000${i}`, DEV, G1, 9 + i, "Legs " + i));
  if (tweak) tweak(db);
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
const shot = (page, name) => page.screenshot({ path: `${SCREENS}/${name}.png` });
const toast = (page) => page.innerText("#toast");
const flat = (t) => t.replace(/\s+/g, " ").trim();
const presenceOps = (db) => db.log.filter((l) => l.path.endsWith("/presence")).map((l) => l.method + (l.body && l.body.gym_id ? ":" + (l.body.gym_id === G1 ? "G1" : l.body.gym_id === G2 ? "G2" : "?") : ""));
for (const theme of ["light", "dark"]) test(`Signed in (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ theme });
  const T = theme + ": ";
  // ---------- friends at the gym now ----------
  let live = flat(await page.innerText("#home-live"));
  check(T + "Home: friend at the gym right now", /^MJ Maya is at Planet Fitness · 2[4-6]m ›$/.test(live), live);
  await shot(page, `p3-${theme}-5-home-live`);
  await page.click("#home-live .live-row");
  await page.waitForTimeout(900);
  let body = flat(await page.innerText("#gym-modal-body"));
  check(T + "tapping it opens that gym, with who's here now", (await page.innerText("#gym-modal-name")) === "Planet Fitness" && /HERE NOW MJ Maya Jensen 2[4-6]m/i.test(body), body);
  // ---------- regulars, crown, badges ----------
  check(T + "regulars: this month, ranked, me first", /REGULARS \w+, you and friends First place E You 5 sessions 2 DP Dev Patel 2 sessions 3 MJ Maya Jensen 1 session/i.test(body), body);
  check(T + "one crown, on first place", (await page.locator("#gym-modal-body .crown").count()) === 1 && (await page.locator("#gym-modal-body .regular").first().locator(".crown").count()) === 1);
  check(T + "visit badges: earned and next", /5 visits 10 visits 5 to go/.test(body) && (await page.locator("#gym-modal-body .badge.is-earned").count()) === 1, body);
  await shot(page, `p3-${theme}-6-gym-regulars`);
  await page.click("#gym-modal-close");
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(1500);
  const row = flat(await page.locator("#places-list .place-row", { hasText: "Planet Fitness" }).innerText());
  check(T + "Gyms list: here-now count", /1 here now/.test(row), row);

  // ---------- off by default ----------
  await page.click("#open-settings"); await page.waitForTimeout(300);
  check(T + "setting exists and is off", (await page.getAttribute("#live-switch", "aria-checked")) === "false");
  await page.click("#open-settings");
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  check(T + "off: nothing about sharing on the log screen", await page.locator("#log-live").isHidden());
  await page.selectOption("#log-gym", G2);
  await page.waitForTimeout(400);
  check(T + "off: choosing a gym tells the server nothing", presenceOps(db).length === 0, presenceOps(db).join(","));
  await page.click("#log-cancel");

  // ---------- turn it on ----------
  await page.click("#open-settings"); await page.waitForTimeout(200);
  await page.click("#live-switch"); await page.waitForTimeout(600);
  check(T + "turning on: switch on, said so", (await page.getAttribute("#live-switch", "aria-checked")) === "true" && /^On\./.test(await toast(page)), await toast(page));
  check(T + "turning on doesn't put you anywhere yet", presenceOps(db).join() === "DELETE", presenceOps(db).join(","));
  await shot(page, `p3-${theme}-7-settings`);
  await page.click("#open-settings");
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  check(T + "a pre-selected gym only offers, it doesn't share", /I’m here now: show my friends/.test(await page.innerText("#log-live")) && presenceOps(db).join() === "DELETE", await page.innerText("#log-live"));
  await page.click("#live-start"); await page.waitForTimeout(500);
  const picked = await page.inputValue("#log-gym");
  check(T + "“I'm here now” shares that gym", presenceOps(db).pop() === "POST:" + (picked === G1 ? "G1" : "G2") && /Friends can see you’re at .+ · 0m Stop/.test(flat(await page.innerText("#log-live"))), presenceOps(db).join(",") + " | " + flat(await page.innerText("#log-live")));
  await shot(page, `p3-${theme}-8-log-live`);
  const other = picked === G1 ? G2 : G1;
  await page.selectOption("#log-gym", other); await page.waitForTimeout(500);
  check(T + "switching gym moves you", presenceOps(db).pop() === "POST:" + (other === G1 ? "G1" : "G2") && db.presence.filter((p) => p.user_id === ME).length === 1 && db.presence.find((p) => p.user_id === ME).gym_id === other, presenceOps(db).join(","));
  const y = new Date(Date.now() - 864e5); const pad = (n) => String(n).padStart(2, "0");
  await page.fill("#log-date", `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`);
  await page.dispatchEvent("#log-date", "change"); await page.waitForTimeout(500);
  check(T + "logging another day stops it", presenceOps(db).pop() === "DELETE" && !db.presence.some((p) => p.user_id === ME) && await page.locator("#log-live").isHidden(), presenceOps(db).join(","));
  await page.click("#log-cancel"); await page.waitForTimeout(200);
  if (await page.locator("#confirm-overlay.open").count()) await page.click("#confirm-yes");

  // ---------- check in from the gym page: explicit, so automatic ----------
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(600);
  await page.locator("#places-list .place-row", { hasText: "Planet Fitness" }).click(); await page.waitForTimeout(600);
  await page.click("#gym-checkin"); await page.waitForTimeout(700);
  check(T + "Check in here shares it, and the last word to the server is the check-in", presenceOps(db).pop() === "POST:G1" && db.presence.some((p) => p.user_id === ME && p.gym_id === G1), presenceOps(db).join(","));
  await page.click('[data-tab="home"]'); await page.waitForTimeout(400);
  live = flat(await page.innerText("#home-live"));
  check(T + "Home says what friends can see, with Stop", /^Friends can see you’re at Planet Fitness · 0m Stop/.test(live), live);
  // a reload keeps it (the row on the server is still there)
  await page.reload(); await page.waitForTimeout(2800);
  check(T + "survives closing and reopening the app", /Friends can see you’re at Planet Fitness/.test(await page.innerText("#home-live")));
  await page.click("#home-live-stop"); await page.waitForTimeout(500);
  check(T + "Stop clears it", !db.presence.some((p) => p.user_id === ME) && !/Friends can see/.test(await page.innerText("#home-live").catch(() => "")));

  // ---------- saving ends it ----------
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(500);
  await page.locator("#places-list .place-row", { hasText: "Planet Fitness" }).click(); await page.waitForTimeout(500);
  await page.click("#gym-checkin"); await page.waitForTimeout(500);
  await page.click("#add-exercise-btn"); await page.waitForTimeout(300);
  await page.fill("#exercise-search", "back squat"); await page.waitForTimeout(300);
  await page.locator("#exercise-modal-list button, #exercise-modal-list [data-ex], #exercise-modal-list > *").first().click(); await page.waitForTimeout(400);
  if (await page.locator("#exercise-modal-overlay.open").count()) { await page.locator("#exercise-modal-list *").filter({ hasText: /Barbell|Back Squat/ }).first().click().catch(() => {}); await page.waitForTimeout(300); }
  const reps = page.locator("#exercise-blocks input").first();
  await reps.fill("5"); await page.locator("#exercise-blocks input").nth(1).fill("225").catch(() => {});
  await page.click("#save-workout-btn"); await page.waitForTimeout(900);
  const saved = (await page.locator("#screen-home.active").count()) === 1;
  check(T + "saving the workout ends it", saved && presenceOps(db).pop() === "DELETE" && !db.presence.some((p) => p.user_id === ME), "saved=" + saved + " " + presenceOps(db).join(",") + " toast=" + await toast(page));
  if (await page.locator("#confirm-overlay.open").count()) await page.click("#confirm-no");
  if (await page.locator("#summary-done").isVisible().catch(() => false)) await page.click("#summary-done");

  // ---------- three hours, enforced on this phone too ----------
  await page.evaluate((g) => { const s = JSON.parse(localStorage.getItem("gymsocial_v1")); s.myLive = { gymId: g, at: new Date(Date.now() - 4 * 3600e3).toISOString() }; localStorage.setItem("gymsocial_v1", JSON.stringify(s)); }, G1);
  db.presence = db.presence.map((p) => p.user_id === MAYA ? { ...p, expires_at: new Date(Date.now() - 60000).toISOString() } : p);
  await page.reload(); await page.waitForTimeout(2800);
  check(T + "after three hours nothing shows: not you, not a friend whose time ran out", await page.locator("#home-live").isHidden(), await page.innerText("#home-live").catch(() => ""));

  // ---------- turn it off ----------
  await page.click("#open-settings"); await page.waitForTimeout(200);
  await page.click("#live-switch"); await page.waitForTimeout(500);
  check(T + "turning off: switch off, server cleared, synced", (await page.getAttribute("#live-switch", "aria-checked")) === "false" && presenceOps(db).pop() === "DELETE");
  await page.waitForTimeout(1800);
  check(T + "the choice is saved to the account", db.profiles[0].settings.shareLive === false, JSON.stringify(db.profiles[0].settings.shareLive));
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
// ---------- ties share the crown ----------
test("Ties share the crown", async ({ browser: b }) => {
  browser = b;
  const { context, page } = await open({ tweak: (db) => { for (let i = 2; i < 5; i++) db.workouts.push({ id: `dddddddd-0000-4000-8000-00000000001${i}`, user_id: DEV, gym_id: G1, title: "More", performed_at: new Date(Date.now() - 600000).toISOString(), ended_at: null, calories: null, photo_path: null, workout_exercises: [] }); } });
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(1200);
  await page.locator("#places-list .place-row", { hasText: "Planet Fitness" }).click(); await page.waitForTimeout(700);
  const body = flat(await page.innerText("#gym-modal-body"));
  check("tie: both on 5 share first place, next is third", (await page.locator("#gym-modal-body .crown").count()) === 2 && /You 5 sessions First place DP Dev Patel 5 sessions 3 MJ Maya Jensen 1 session/.test(body), body);
  await context.close();
});
// ---------- database that hasn't run 009 ----------
test("Database that hasn't run 009", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ legacy9: true });
  check("pre-009: no live strip", await page.locator("#home-live").isHidden());
  await page.click("#open-settings"); await page.waitForTimeout(200);
  await page.click("#live-switch"); await page.waitForTimeout(600);
  check("pre-009: switch explains and stays off", (await page.getAttribute("#live-switch", "aria-checked")) === "false" && /needs a database update/.test(await toast(page)), await toast(page));
  await page.click("#open-settings");
  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(1200);
  await page.locator("#places-list .place-row", { hasText: "Planet Fitness" }).click(); await page.waitForTimeout(700);
  check("pre-009: regulars and badges still work (they need no database change)", /REGULARS/i.test(await page.innerText("#gym-modal-body")) && /5 visits/.test(await page.innerText("#gym-modal-body")));
  check("pre-009: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
// ---------- signed out ----------
test("Signed out", async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open({ signedIn: false });
  await page.click("#open-settings"); await page.waitForTimeout(200);
  check("signed out: no sharing switch, no live strip", (await page.locator("#live-switch").count()) === 0 && await page.locator("#home-live").isHidden());
  check("signed out: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
