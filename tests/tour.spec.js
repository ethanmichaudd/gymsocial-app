/**
 * The first-time walkthrough (tour.js).
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript } from "./support/supabase.js";

async function open(browser, { signedIn = false, theme = "light", returning = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb();
  db.showTour = true;
  db.profiles[0].settings = { theme, customEquipment: [] };
  await install(context, db); await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  if (returning) await context.addInitScript(() => { if (!localStorage.getItem("gymsocial_v1")) localStorage.setItem("gymsocial_v1", JSON.stringify({ version: 1 })); });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_);
  await page.waitForTimeout(1200);
  return { context, page, db, errors };
}
const shown = (page) => page.evaluate(() => !document.getElementById("tour").hidden);
const flat = (t) => t.replace(/\s+/g, " ").trim();

for (const theme of ["light", "dark"]) test(`First open: the tour (${theme})`, async ({ browser }) => {
  const { context, page, errors } = await open(browser, { theme });
  if (theme === "dark") {
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  }
  check(theme + ": a first-time visitor gets the tour", await shown(page));
  const titles = await page.$$eval(".tour-title", (els) => els.map((e) => e.textContent));
  check(theme + ": welcome, seven on logging, then friends, gyms, goal", titles.join(" | ") === "Welcome to GymSocial | Start a workout | Add an exercise | Pick the equipment | Log your sets | Cardio counts too | Finish and save | Change it later | Train with your friends | Your gym is a place | Set your weekly goal", titles.join(" | "));
  check(theme + ": each card says which part it's about", (await page.$$eval(".tour-chapter", (els) => els.map((e) => e.textContent))).join(",") === ",Logging,Logging,Logging,Logging,Logging,Logging,Logging,Friends,Gyms,Your goal");
  await page.screenshot({ path: `${SCREENS}/tour-${theme}-1.png` });
  for (let i = 0; i < 10; i++) {
    await page.click("#tour-next"); await page.waitForTimeout(450);
    if (i === 2) await page.screenshot({ path: `${SCREENS}/tour-${theme}-equip.png` });
    if (i === 6) await page.screenshot({ path: `${SCREENS}/tour-${theme}-swipe.png` });
  }
  await page.screenshot({ path: `${SCREENS}/tour-${theme}-4.png` });
  check(theme + ": last card swaps Next for the way in", await page.locator("#tour-next").isHidden() && await page.locator("#tour-signup").isVisible() && await page.locator("#tour-start").isVisible());
  check(theme + ": the ✕ is still there on the last card", await page.locator("#tour-skip").isVisible());
  await page.click('[data-tour-goal="4"]');
  check(theme + ": picking a goal shows it big", (await page.innerText("#tour-goal-num")) === "4");
  await page.click("#tour-signup"); await page.waitForTimeout(500);
  check(theme + ": Create an account opens sign-up", !(await page.evaluate(() => document.getElementById("auth-page").hidden)) && /Create your account/.test(await page.innerText("#auth-title")));
  check(theme + ": the goal stuck", await page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")).settings.weeklyGoal === 4));
  await page.click("#auth-close"); await page.waitForTimeout(200);
  await page.reload(); await page.waitForTimeout(1200);
  check(theme + ": only once", !(await shown(page)));
  // Settings -> Take the tour
  await page.click("#open-settings"); await page.waitForTimeout(300);
  await page.click("#open-tour"); await page.waitForTimeout(400);
  check(theme + ": Settings can show it again", await shown(page));
  check(theme + ": a way out on the first card: ✕ and Skip tour", await page.locator("#tour-skip").isVisible() && await page.locator("#tour-skip-text").isVisible());
  await page.click("#tour-skip"); await page.waitForTimeout(400);
  check(theme + ": ✕ closes it", !(await shown(page)));
  await page.click("#open-tour"); await page.waitForTimeout(400);
  await page.click("#tour-skip-text"); await page.waitForTimeout(400);
  check(theme + ": so does Skip tour", !(await shown(page)));
  await page.click("#open-tour"); await page.waitForTimeout(400);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  check(theme + ": and Escape, on a keyboard", !(await shown(page)));
  check(theme + ": no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Tour: swipe between cards, and Just start logging", async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  await page.evaluate(() => { const t = document.getElementById("tour-track"); t.scrollTo({ left: t.clientWidth * 10 }); });
  await page.waitForTimeout(600);
  check("swiping to the last card shows its buttons", await page.locator("#tour-start").isVisible());
  await page.click("#tour-start"); await page.waitForTimeout(500);
  check("Just start logging lands on Log", !(await shown(page)) && await page.evaluate(() => document.getElementById("screen-log").classList.contains("active")));
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Tour: not for someone who's used the app before", async ({ browser }) => {
  const { context, page } = await open(browser, { returning: true });
  check("a phone with saved data never sees it", !(await shown(page)));
  await context.close();
  const b = await open(browser, { signedIn: true });
  check("a signed-in phone never sees it", !(await shown(b.page)));
  await b.context.close();
});
