/**
 * Signing in on a new phone.
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import fs from "node:fs";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, sessionScript } from "./support/supabase.js";

let browser;      // set by each test: the helpers below open their pages with it
const out = [];
const AVATAR = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z";
async function ctx(db, pre) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  await install(context, db);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  if (pre) { await page.goto(URL_); await page.waitForTimeout(800); await pre(page); }
  await page.evaluate(sessionScript()).catch(async () => { await page.goto(URL_); await page.evaluate(sessionScript()); });
  await page.goto(URL_);
  await page.waitForTimeout(4500);   // sync, then the delayed push
  return { context, page, errors };
}
// 1) established account, brand-new phone
test("Established account, brand-new phone", async ({ browser: b }) => {
  browser = b;
  const db = makeDb();
  Object.assign(db.profiles[0], { avatar: AVATAR, weekly_goal: 5, settings: { theme: "dark", customEquipment: ["Kettlebell"], inboxSeenAt: "2026-11-14T00:00:00.000Z" } });
  const { context, page, errors } = await ctx(db);
  const me = db.profiles[0];
  check("new phone: account name kept", me.display_name === "Ethan", String(me.display_name));
  check("new phone: account photo kept", me.avatar === AVATAR);
  check("new phone: weekly goal kept", me.weekly_goal === 5, String(me.weekly_goal));
  check("new phone: theme + equipment + inbox last-seen kept", me.settings.theme === "dark" && (me.settings.customEquipment || [])[0] === "Kettlebell" && me.settings.inboxSeenAt === "2026-11-14T00:00:00.000Z", JSON.stringify(me.settings).slice(0, 160));
  check("new phone: shows dark theme + name", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")));
  check("new phone: local copy took the account's profile", local.me.name === "Ethan" && local.settings.weeklyGoal === 5 && local.me.avatar === AVATAR);
  // a later change on this phone still goes up
  await page.click("#open-settings"); await page.click('[data-theme-set="light"]'); await page.waitForTimeout(2500);
  check("later change on this phone still syncs up", me.settings.theme === "light" && me.display_name === "Ethan" && me.avatar === AVATAR, me.settings.theme);
  check("new phone: no console errors", errors.length === 0, errors.join(" || "));
  await page.screenshot({ path: SCREENS + "/newphone.png" });
  await context.close();
});
// 2) brand-new account, phone already set up before signing in
test("Brand-new account, phone already set up before signing in", async ({ browser: b }) => {
  browser = b;
  const db = makeDb();
  Object.assign(db.profiles[0], { display_name: null, settings: {} });
  const { context, page, errors } = await ctx(db, async (page) => {
    await page.click("#open-settings"); await page.click('[data-theme-set="dark"]'); await page.waitForTimeout(300);
  });
  const me = db.profiles[0];
  check("new account: phone's settings go up", me.settings.theme === "dark", JSON.stringify(me.settings).slice(0, 120));
  check("new account: still dark here", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
  check("new account: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
console.log(out.join("\n"));
