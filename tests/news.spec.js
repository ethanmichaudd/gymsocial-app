/**
 * The one-time "new app icon" message: who sees it, what it says, and that
 * dismissing it is permanent. Run with: npm test
 */
import { test } from "@playwright/test";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript } from "./support/supabase.js";

const flat = (t) => t.replace(/\s+/g, " ").trim();
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function open(browser, { signedIn = false, usedBefore = false, iphone = false, theme = "light", query = "" } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block", ...(iphone ? { userAgent: IPHONE } : {}) });
  const db = makeDb();
  db.showNews = true;
  db.profiles[0].settings = { theme, customEquipment: [] };
  await install(context, db); await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  if (usedBefore) await context.addInitScript(() => { if (!localStorage.getItem("gymsocial_sync_v1")) localStorage.setItem("gymsocial_sync_v1", "{}"); });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_ + query);
  await page.waitForTimeout(signedIn ? 2800 : 1500);
  return { context, page, db, errors };
}
const showing = (page) => page.locator("#list-modal-overlay.open #news-ok").count().then((n) => n === 1);
const flag = (page) => page.evaluate(() => localStorage.getItem("gymsocial_news_logo_v1"));

test("new icon message: someone new never sees it", async ({ browser }) => {
  const { context, page, errors } = await open(browser);
  check("new: no message on a first-ever open", !(await showing(page)));
  check("new: and it is marked so it never shows later", (await flag(page)) === "1");
  await page.reload(); await page.waitForTimeout(1500);
  check("new: still nothing on the next open", !(await showing(page)));
  check("new: no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});

for (const theme of ["light", "dark"]) {
  test("new icon message: signed in on an iPhone (" + theme + ")", async ({ browser }) => {
    const { context, page, errors } = await open(browser, { signedIn: true, iphone: true, theme });
    const T = theme + ": ";
    check(T + "the message opens by itself", await showing(page) && (await page.innerText("#list-modal-title")) === "New app icon");
    const text = flat(await page.innerText("#list-modal-body"));
    const img = await page.evaluate(() => { const i = document.querySelector(".news-icon"); return { src: i.getAttribute("src"), ok: i.complete && i.naturalWidth === 192, alt: i.alt }; });
    check(T + "it shows the new icon", img.src === "icon-192.png" && img.ok && /dumbbell/.test(img.alt), JSON.stringify(img));
    check(T + "iPhone steps: remove, open in Safari, Share, Add to Home Screen, sign in", /Remove App.*Delete from Home Screen.*localhost:5199 in Safari.*Share button.*Add to Home Screen.*sign in/.test(text), text);
    check(T + "signed in: says the workouts are safe", /saved to your account/.test(text) && !/not signed in/i.test(text), text);
    check(T + "nothing is cut off: the button is on screen", await page.evaluate(() => { const r = document.getElementById("news-ok").getBoundingClientRect(); return r.bottom <= window.innerHeight && r.top > 0; }));
    await page.screenshot({ path: `${SCREENS}/news-${theme}.png` });

    // not dismissed yet: closing the app and reopening shows it again
    await page.reload(); await page.waitForTimeout(2800);
    check(T + "not dismissed: it shows again on the next open", await showing(page) && (await flag(page)) === null);

    await page.click("#news-ok"); await page.waitForTimeout(300);
    check(T + "Got it closes it", !(await page.locator("#list-modal-overlay.open").count()) && (await flag(page)) === "1");
    await page.reload(); await page.waitForTimeout(2800);
    check(T + "dismissed: never shown again", !(await showing(page)));
    await page.reload(); await page.waitForTimeout(2800);
    check(T + "...or the time after that", !(await showing(page)));
    check(T + "no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  });
}

test("new icon message: signed out, not an iPhone, closed with Close", async ({ browser }) => {
  const { context, page, errors } = await open(browser, { usedBefore: true });
  const T = "signed out: ";
  check(T + "someone who used the app before sees it", await showing(page));
  const text = flat(await page.innerText("#list-modal-body"));
  check(T + "warned that removing the app erases workouts on this phone", /not signed in\. Removing the app erases the workouts on this phone/.test(text), text);
  check(T + "steps for other phones", /Add to Home screen \(or Install app\)/.test(text) && !/Safari/.test(text), text);
  await page.click("#list-modal-close"); await page.waitForTimeout(300);
  check(T + "the Close button also dismisses it for good", (await flag(page)) === "1");
  await page.reload(); await page.waitForTimeout(1500);
  check(T + "not shown again", !(await showing(page)));
  check(T + "no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
});

test("new icon message: waits when the app was opened from a notification", async ({ browser }) => {
  const { context, page } = await open(browser, { signedIn: true, query: "?inbox=1" });
  check("link: the Inbox opens, not the message", !(await showing(page)) && (await page.innerText("#list-modal-title")) === "Inbox");
  check("link: the message is kept for next time", (await flag(page)) === null);
  await context.close();
});
