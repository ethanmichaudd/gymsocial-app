/**
 * Inbox and reactions.
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import fs from "node:fs";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, ME } from "./support/supabase.js";

let browser;      // set by each test: the helpers below open their pages with it


async function open({ signedIn, legacy = false, theme = "light" }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb({ legacy });
  db.profiles[0].settings.theme = theme;
  await install(context, db);
  await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_);
  await page.waitForTimeout(signedIn ? 2500 : 1200);
  if (signedIn && theme === "dark") {
    // the way a person does it: Settings -> Dark
    await page.click("#open-settings");
    await page.click('[data-theme-set="dark"]');
    await page.click("#open-settings");
    await page.waitForTimeout(300);
  }
  return { context, page, db, errors };
}
const shot = (page, name) => page.screenshot({ path: `${SCREENS}/${name}.png` });
const badge = (page) => page.evaluate(() => { const b = document.getElementById("inbox-badge"); return b.hidden ? "" : b.textContent; });

// ---------- signed in ----------
for (const theme of ["light", "dark"]) test(`Signed in (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ signedIn: true, theme });
  const T = theme + ": ";
  check(T + "badge shows 6 (1 request + 5 new)", (await badge(page)) === "6", await badge(page));
  await shot(page, `${theme}-1-home`);

  await page.click("#open-inbox");
  await page.waitForTimeout(900);
  const text = await page.innerText("#list-modal-body");
  check(T + "inbox lists request", /Priya Rao/.test(text) && /Accept/.test(text));
  check(T + "inbox lists reaction w/ custom emoji from non-friend", /Sam Kim\s*\u{1F389}\s*your\s*Leg Day/u.test(text), text.replace(/\n/g, " | "));
  check(T + "inbox lists accepted + legacy friends", /Maya Jensen accepted your request/.test(text) && /You and Dev Patel are friends/.test(text));
  check(T + "5 rows marked new", (await page.locator(".inbox-row.is-new").count()) === 5, String(await page.locator(".inbox-row.is-new").count()));
  check(T + "badge drops to 1 after opening", (await badge(page)) === "1", await badge(page));
  await shot(page, `${theme}-2-inbox`);
  await page.waitForTimeout(1800);
  const pushed = db.log.filter((l) => l.method === "PATCH" && l.path.endsWith("/profiles")).pop();
  check(T + "last-seen pushed in settings", !!(pushed && pushed.body.settings && pushed.body.settings.inboxSeenAt));

  // reaction row -> the workout
  await page.locator(".inbox-row[data-inbox-wk]").first().click();
  await page.waitForTimeout(300);
  const detail = await page.innerText("#list-modal-body");
  check(T + "reaction row opens workout w/ reactors", /Leg Day/.test(detail) && /Reactions \(2\)/i.test(detail) && /Sam Kim/.test(detail));
  await shot(page, `${theme}-3-workout`);
  // non-friend reactor -> profile with Add friend
  await page.locator(".reactor-row", { hasText: "Sam Kim" }).click();
  await page.waitForTimeout(300);
  check(T + "non-friend reactor opens profile", /Add friend/.test(await page.innerText("#list-modal-body")));
  await page.click("#list-modal-close");

  // accept from the inbox
  await page.click("#open-inbox");
  await page.waitForTimeout(700);
  await page.locator('.inbox-request [data-act="accept"]').click();
  await page.waitForTimeout(1200);
  check(T + "accept clears request + badge", (await badge(page)) === "" && !/Accept/.test(await page.innerText("#list-modal-body")), await badge(page));
  check(T + "accept called rpc", db.log.some((l) => l.path.endsWith("accept_friend_request")));
  await page.click("#list-modal-close");

  // custom reaction in the feed: the React arrow opens every choice
  await page.click('[data-tab="friends"]');
  await page.waitForTimeout(500);
  const picker = async () => { await page.locator(".friend-card .feed-react-more").first().click(); await page.waitForTimeout(300); return page.locator("#list-modal-body .react-bar"); };
  let bar = await picker();
  check(T + "picker = quick four + plus", (await bar.locator("button.react").count()) === 4 && (await bar.locator("input.react-add").count()) === 1);
  await bar.locator("input.react-add").fill("ab");
  await page.waitForTimeout(200);
  check(T + "letters rejected", /Pick one emoji/.test(await page.innerText("#toast")) && !db.log.some((l) => l.path.endsWith("/reactions")));
  await page.locator("#list-modal-body input.react-add").fill("\u{1F389}\u{1F389}");
  await page.waitForTimeout(200);
  check(T + "two emoji rejected", !db.log.some((l) => l.path.endsWith("/reactions")));
  await page.locator("#list-modal-body input.react-add").fill("\u{1F44D}\u{1F3FD}");
  await page.waitForTimeout(400);
  let mine = db.reactions.find((r) => r.user_id === ME);
  check(T + "custom emoji (skin tone) saved", !!mine && mine.emoji === "\u{1F44D}\u{1F3FD}", mine && mine.emoji);
  check(T + "custom emoji shown on my React button", (await page.locator(".friend-card .feed-react.is-mine").first().innerText()).includes("\u{1F44D}\u{1F3FD}"));
  await shot(page, `${theme}-4-feed`);
  // switch to a quick one: still one per person
  bar = await picker();
  await page.locator('#list-modal-body [data-react$="\u{1F525}"]').click();
  await page.waitForTimeout(400);
  check(T + "one reaction per person", db.reactions.filter((r) => r.user_id === ME).length === 1 && db.reactions.find((r) => r.user_id === ME).emoji === "\u{1F525}");
  bar = await picker();
  check(T + "unused custom chip disappears", (await bar.locator("button.react").count()) === 4, String(await bar.locator("button.react").count()));
  await page.click("#list-modal-close"); await page.waitForTimeout(200);
  // flag (two code points) through the detail sheet
  await page.locator(".friend-open").first().click();
  await page.waitForTimeout(300);
  await page.locator("#list-modal-body input.react-add").fill("\u{1F1FA}\u{1F1F8}");
  await page.waitForTimeout(400);
  check(T + "flag emoji saved from detail sheet", db.reactions.find((r) => r.user_id === ME).emoji === "\u{1F1FA}\u{1F1F8}");
  await page.click("#list-modal-close");

  // home day card still works
  await page.click('[data-tab="home"]');
  await page.waitForTimeout(300);
  await shot(page, `${theme}-5-home-after`);
  // ?friends=1 (push notification) lands in the inbox
  await page.goto(URL_ + "?friends=1");
  await page.waitForTimeout(2500);
  check(T + "?friends=1 opens Inbox", (await page.innerText("#list-modal-title")) === "Inbox" && await page.locator("#inbox-root").count() === 1);
  check(T + "theme applied", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === theme);
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

// ---------- database that hasn't run 007 ----------
test("Database that hasn't run 007", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ signedIn: true, legacy: true });
  await page.click("#open-inbox");
  await page.waitForTimeout(900);
  const text = await page.innerText("#list-modal-body");
  check("pre-migration: inbox still lists everything", /Priya Rao/.test(text) && /Sam Kim/.test(text) && /You and Maya Jensen are friends/.test(text), text.replace(/\n/g, " | "));
  await shot(page, "legacy-inbox");
  await page.click("#list-modal-close");
  await page.click('[data-tab="friends"]');
  await page.waitForTimeout(400);
  await page.locator(".friend-card .feed-react-more").first().click(); await page.waitForTimeout(300);
  await page.locator("#list-modal-body input.react-add").fill("\u{1F680}");
  await page.waitForTimeout(400);
  check("pre-migration: custom reaction saves", db.reactions.some((r) => r.user_id === ME && r.emoji === "\u{1F680}"));
  check("pre-migration: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

// ---------- signed out ----------
for (const theme of ["light", "dark"]) test(`Signed out (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open({ signedIn: false });
  if (theme === "dark") {
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("gymsocial_v1")); s.settings.theme = "dark"; localStorage.setItem("gymsocial_v1", JSON.stringify(s)); });
    await page.reload(); await page.waitForTimeout(1000);
  }
  check(`signed out ${theme}: no badge`, (await badge(page)) === "");
  await page.click("#open-inbox");
  await page.waitForTimeout(300);
  check(`signed out ${theme}: inbox asks to sign in`, /Sign in/.test(await page.innerText("#list-modal-body")));
  await shot(page, `signedout-${theme}-inbox`);
  await page.locator("#list-modal-body [data-open-auth]").click();
  await page.waitForTimeout(300);
  check(`signed out ${theme}: sign in opens auth, closes sheet`, !(await page.evaluate(() => document.getElementById("auth-page").hidden)) && !(await page.evaluate(() => document.getElementById("list-modal-overlay").classList.contains("open"))));
  await page.click("#auth-close");
  for (const tab of ["friends", "log", "gyms", "profile", "home"]) { await page.click(`[data-tab="${tab}"]`); await page.waitForTimeout(150); }
  await page.click("#open-settings"); await page.waitForTimeout(200);
  await shot(page, `signedout-${theme}-settings`);
  check(`signed out ${theme}: no console errors`, errors.length === 0, errors.join(" || "));
  await context.close();
});
