/**
 * Loading: the launch screen, and the shapes shown while something is on
 * its way. Runs the real app against the stand-in Supabase.
 */
import { test } from "@playwright/test";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, G1 } from "./support/supabase.js";

async function open(browser, { signedIn = true, theme = "light", slow = 0, seed = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb();
  db.profiles[0].settings = { theme, customEquipment: [] };
  await install(context, db); await installMaps(context, db);
  if (slow) {
    // friends (and gym totals) take a while to arrive
    await context.route(/supabase\.co\/rest\/v1\/(connections|rpc\/gym_stats)/, async (route) => {
      await new Promise((r) => setTimeout(r, slow));
      return route.fallback();
    });
  }
  if (signedIn) await context.addInitScript(sessionScript());
  if (seed) await context.addInitScript(seed);
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  return { context, page, db, errors };
}
const splashUp = (page) => page.evaluate(() => { const s = document.getElementById("splash"); return !!s && !s.classList.contains("is-done"); });

for (const theme of ["light", "dark"]) test(`Launch screen (${theme})`, async ({ browser }) => {
  const { context, page, errors } = await open(browser, { signedIn: false });
  await page.goto(URL_);
  await page.waitForTimeout(1200);
  check(theme + ": signed out, it's gone as soon as the app's ready", !(await splashUp(page)));
  if (theme === "dark") { await page.click("#open-settings"); await page.click('[data-theme-set="dark"]'); await page.click("#open-settings"); }
  // the next open: before any script runs
  await page.route("**/src/main.js", (route) => new Promise((r) => setTimeout(() => r(route.continue()), 1500)));
  await page.reload({ waitUntil: "commit" });
  await page.waitForSelector("#splash", { state: "attached" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENS}/splash-${theme}.png` });
  check(theme + ": the launch screen is up first, in the saved theme", (await splashUp(page)) && (await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "light")) === theme);
  await page.waitForTimeout(2500);
  check(theme + ": and goes once the app is ready", !(await splashUp(page)));
  check(theme + ": no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Launch screen: a new phone waits for the first sync, then shows the app", async ({ browser }) => {
  const { context, page, errors } = await open(browser, { signedIn: true });
  // the first sync takes a moment (as it does on a real network)
  await context.route(/supabase\.co\/rest\/v1\/workouts/, async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    return route.fallback();
  });
  await page.goto(URL_);
  await page.waitForTimeout(300);
  check("signed in, nothing on this phone yet: still loading", await splashUp(page));
  await page.waitForTimeout(3000);
  check("then the app", !(await splashUp(page)));
  await page.reload(); await page.waitForTimeout(400);
  check("the next open (synced before): straight in, no waiting on the network", !(await splashUp(page)));
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Loading shapes: Friends, Inbox and a gym page while they load", async ({ browser }) => {
  const { context, page, errors } = await open(browser, { slow: 6500 });
  await page.goto(URL_);
  await page.waitForTimeout(4300);               // the launch screen gives up at 4s; friends still on their way
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(200);
  const feed = await page.innerText("#friends-feed");
  check("Friends: shapes, not \"Train with friends\"", (await page.locator("#friends-feed .skel-card").count()) === 2 && !/Train with friends/.test(feed), feed);
  await page.screenshot({ path: `${SCREENS}/loading-friends.png` });
  await page.waitForTimeout(7000);
  check("then the real feed", (await page.locator("#friends-feed .skel").count()) === 0 && (await page.locator(".feed-card").count()) >= 1);

  await page.click('[data-tab="gyms"]'); await page.waitForTimeout(2500);
  await page.locator("#places-list .place-row:not(.is-osm)", { hasText: "Planet Fitness" }).click();
  await page.waitForTimeout(500);
  check("gym page: shapes while its totals load (not \"What you train here\")", (await page.locator("#gym-modal-body .skel-row").count()) === 3 && !/What you train here/i.test(await page.innerText("#gym-modal-body")));
  await page.screenshot({ path: `${SCREENS}/loading-gym.png` });
  await page.waitForTimeout(7500);
  check("then the totals", (await page.locator("#gym-modal-body .skel").count()) === 0 && /Popular here/i.test(await page.innerText("#gym-modal-body")));
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
