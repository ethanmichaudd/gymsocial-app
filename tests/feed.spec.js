/**
 * The Friends feed: friend strip, this week's leaderboard, streaks, and the
 * workout card (who/where/when, three numbers, best lifts, PRs, who
 * reacted, latest comment, React / Comment / Share).
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, ME, MAYA, DEV, W2 } from "./support/supabase.js";

let browser;
async function open({ signedIn = true, legacy = false, theme = "light", tweak } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb({ legacy });
  db.profiles[0].settings = { theme, customEquipment: [] };
  if (tweak) tweak(db);
  await install(context, db); await installMaps(context, db);
  if (signedIn) await context.addInitScript(sessionScript());
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  await page.goto(URL_);
  await page.waitForTimeout(signedIn ? 2600 : 1000);
  return { context, page, db, errors };
}
const shot = (page, name) => page.screenshot({ path: `${SCREENS}/${name}.png` });
const flat = (t) => t.replace(/\s+/g, " ").trim();
const mine = (db) => db.reactions.filter((r) => r.user_id === ME && r.workout_id === W2);

// Maya's Push Day (W2, 3h ago) set a record, as her phone saw it
const withPr = (db) => {
  db.workouts.find((w) => w.id === W2).highlights = [{ name: "Bench Press", display: "245lb", delta: "10lb" }];
};

for (const theme of ["light", "dark"]) test(`Feed, signed in (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ theme, tweak: withPr });
  const T = theme + ": ";
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(700);
  await shot(page, `feed-${theme}-1`);

  // ---- header ----
  check(T + "add-friends icon instead of the word Manage, with the request count", (await page.innerText("#friends-manage")).trim() === "1" && (await page.locator("#friends-manage svg").count()) === 1, await page.innerText("#friends-manage"));

  // ---- friend strip ----
  const strip = await page.$$eval(".friend-strip .strip-face", (els) => els.map((e) => e.querySelector(".strip-name").textContent + (e.classList.contains("is-live") ? "*live" : e.classList.contains("is-today") ? "*today" : "")));
  check(T + "strip: Maya first (at the gym now), you, Dev, then Invite", strip.join(",") === "Maya*live,You,Dev,Invite", strip.join(","));
  await page.locator('.strip-face[data-profile="' + DEV + '"]').click(); await page.waitForTimeout(300);
  check(T + "a face opens that person's profile", /Dev Patel/.test(await page.innerText("#list-modal-body")) && /@devp/.test(await page.innerText("#list-modal-body")));
  await page.click("#list-modal-close"); await page.waitForTimeout(200);

  // ---- this week ----
  const board = flat(await page.innerText("#feed-board"));
  check(T + "leaderboard line names who's ahead this week", /^This week/i.test(board) && /Maya 1/.test(board), board);
  await page.click("#feed-board"); await page.waitForTimeout(300);
  const sheet = flat(await page.innerText("#list-modal-body"));
  check(T + "leaderboard sheet ranks everyone, you included", (await page.locator(".board-row").count()) === 3 && /You/.test(sheet) && /Maya Jensen/.test(sheet) && /Dev Patel/.test(sheet), sheet);
  check(T + "five boards to pick from", (await page.locator(".board-tab").allInnerTexts()).join(",") === "Workouts,Time,Volume,Streak,Cardio");
  const rowsText = async () => (await page.locator(".board-row").allInnerTexts()).map(flat);
  await page.click('[data-board="time"]'); await page.waitForTimeout(300);
  let r = await rowsText();
  check(T + "Time board: 55m each, ties share the medal, Dev last", r.some((x) => /^🥇 MJ Maya Jensen 55m$/.test(x)) && /^3 DP Dev Patel 0m$/.test(r[2]), r.join(" | "));
  await shot(page, `feed-${theme}-2-board`);
  await page.click('[data-board="volume"]'); await page.waitForTimeout(300);
  r = await rowsText();
  check(T + "Volume board: Maya 2,350 lb", r.some((x) => /Maya Jensen 2,350 lb$/.test(x)), r.join(" | "));
  await page.click('[data-board-range="month"]'); await page.waitForTimeout(300);
  r = await rowsText();
  check(T + "This month adds my Leg Day (26h ago) when it's this month", r.length === 3, r.join(" | "));
  await page.click('[data-board="streak"]'); await page.waitForTimeout(300);
  check(T + "Streak board has no week/month switch", (await page.locator("[data-board-range]").count()) === 0);
  await page.click('[data-board="cardio"]'); await page.waitForTimeout(300);
  r = await rowsText();
  check(T + "Cardio board: everyone at 0 mi, no medals", r.every((x) => /0 mi$/.test(x) && !/🥇/.test(x)), r.join(" | "));
  await page.click('[data-board="volume"]'); await page.waitForTimeout(300);
  await page.click("#list-modal-close"); await page.waitForTimeout(200);
  const strip2 = flat(await page.innerText("#feed-board"));
  check(T + "feed line follows the last board picked", /^Volume · This month/i.test(strip2) && /Maya 2,350/.test(strip2), strip2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")).settings);
  check(T + "choice remembered", saved.boardKind === "volume" && saved.boardRange === "month", JSON.stringify(saved).slice(0, 200));

  // ---- the card ----
  const card = page.locator(".feed-card").first();
  const text = flat(await card.innerText());
  check(T + "who · where · when on one line", /Maya Jensen Planet Fitness · 3h/.test(text), text);
  check(T + "title, then the numbers", /Push Day with you 55m TIME 2 SETS 2,350 VOLUME LB/i.test(text), text);
  check(T + "PR banner from her phone's records", /New PR · Bench Press 245lb \(\+10lb\)/.test(text), text);
  check(T + "best lift with a PR tag", /Bench Press 245×5 🏆 PR/.test(text), text);
  check(T + "who reacted, in words", /💪 Dev/.test(text), text);
  check(T + "latest comment preview", /Dev nice session/.test(text), text);
  check(T + "one action row: React, Comment count, Share", (await card.locator(".feed-actions .feed-act").count()) === 4 && (await card.locator(".comment-chip .react-n").innerText()) === "1" && /Share/.test(text));
  check(T + "no long wrapping detail line any more", !/exercises ·/.test(text), text);

  // ---- reacting ----
  await card.locator(".feed-react").click(); await page.waitForTimeout(500);
  check(T + "tap React = 💪, saved", mine(db).length === 1 && mine(db)[0].emoji === "💪", JSON.stringify(mine(db)));
  check(T + "button shows it's yours, line says You", /Reacted/.test(await page.locator(".feed-card .feed-react").first().innerText()) && /You and Dev/.test(flat(await page.locator(".feed-card").first().innerText())));
  await page.locator(".feed-card .feed-react").first().click(); await page.waitForTimeout(500);
  check(T + "tap again takes it back", mine(db).length === 0);
  await page.locator(".feed-card .feed-react-more").first().click(); await page.waitForTimeout(300);
  check(T + "arrow opens the picker", (await page.innerText("#list-modal-title")) === "React" && (await page.locator("#list-modal-body input.react-add").count()) === 1);
  await shot(page, `feed-${theme}-3-picker`);
  await page.locator('#list-modal-body [data-react$="🔥"]').click(); await page.waitForTimeout(500);
  check(T + "picked 🔥: saved, sheet closed, button shows 🔥", mine(db).length === 1 && mine(db)[0].emoji === "🔥" &&
    !(await page.evaluate(() => document.getElementById("list-modal-overlay").classList.contains("open"))) &&
    /🔥\s*Reacted/.test(await page.locator(".feed-card .feed-react").first().innerText()));
  // press and hold
  const btn = page.locator(".feed-card .feed-react").first();
  const box = await btn.boundingBox();
  await page.dispatchEvent(".feed-card .feed-react >> nth=0", "touchstart", { touches: [{ identifier: 1, clientX: box.x + 10, clientY: box.y + 10 }] });
  await page.waitForTimeout(650);
  await page.dispatchEvent(".feed-card .feed-react >> nth=0", "touchend", {});
  check(T + "press and hold opens the picker too", (await page.innerText("#list-modal-title")) === "React");
  await page.locator("#list-modal-body input.react-add").fill("🎉"); await page.waitForTimeout(500);
  check(T + "any emoji from the picker", mine(db).length === 1 && mine(db)[0].emoji === "🎉", JSON.stringify(mine(db)));

  // ---- comment + share ----
  await page.locator(".feed-card .comment-chip").first().click(); await page.waitForTimeout(400);
  check(T + "Comment opens the thread", (await page.locator("#comment-input").count()) === 1);
  await page.click("#list-modal-close"); await page.waitForTimeout(200);
  await page.locator(".feed-card .feed-share").first().click(); await page.waitForTimeout(300);
  check(T + "Share opens the share picture", (await page.innerText("#list-modal-title")) === "Share");
  await page.click("#list-modal-close"); await page.waitForTimeout(200);
  // tapping the card body opens the workout
  await page.locator(".feed-card .feed-body").first().click(); await page.waitForTimeout(300);
  check(T + "tapping the card opens the workout", (await page.innerText("#list-modal-title")) === "Workout" && /Push Day/.test(await page.innerText("#list-modal-body")));
  await page.click("#list-modal-close");
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Feed: streaks, invite, saving a record", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({
    tweak: (d) => {
      // Dev trained each of the last 4 weeks, this one included
      const base = d.workouts.find((w) => w.id === W2);
      for (let i = 0; i < 4; i++) {
        const when = new Date(); when.setDate(when.getDate() - 7 * i); when.setHours(when.getHours() - 1);
        const copy = JSON.parse(JSON.stringify(base));
        copy.id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb" + i; copy.user_id = DEV; copy.title = "Dev " + i;
        copy.performed_at = when.toISOString(); copy.ended_at = null;
        d.workouts.push(copy);
      }
    }
  });
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(700);
  const ms = flat(await page.locator(".milestone").first().innerText().catch(() => ""));
  check("streak milestone for Dev", /Dev is on a 4-week streak/.test(ms), ms);
  await page.locator(".milestone-react").first().click(); await page.waitForTimeout(500);
  check("reacting to the streak reacts to his latest workout", db.reactions.some((r) => r.user_id === ME && r.workout_id === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0" && r.emoji === "🔥"));
  await shot(page, "feed-streak");

  // a new record of mine goes up with the workout
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  await page.click("#add-exercise-btn"); await page.waitForTimeout(300);
  await page.fill("#exercise-search", "Back Squat"); await page.waitForTimeout(300);
  await page.locator("#exercise-modal-list .picker-row:not(.is-create)").first().click(); await page.waitForTimeout(300);
  await page.locator("#exercise-blocks .set-v1").first().fill("5");
  await page.locator("#exercise-blocks .set-v2").first().fill("275");
  await page.click("#finish-workout-btn"); await page.waitForTimeout(250); await page.click("#save-workout-btn"); await page.waitForTimeout(2500);
  const up = db.log.filter((l) => l.method === "POST" && l.path.endsWith("/workouts")).pop();
  check("saved workout carries its PR for friends", !!(up && up.body && JSON.stringify(up.body).includes('"highlights"') && JSON.stringify(up.body).includes("Back Squat")), up && JSON.stringify(up.body).slice(0, 300));
  check("no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

test("Feed: database without 012, and no friends", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ legacy: true });
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(700);
  check("pre-012: feed still draws, no PR banner", (await page.locator(".feed-card").count()) >= 1 && (await page.locator(".feed-pr").count()) === 0);
  // a record saved before 012: the column is refused, the workout still syncs
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  await page.click("#add-exercise-btn"); await page.waitForTimeout(300);
  await page.fill("#exercise-search", "Back Squat"); await page.waitForTimeout(300);
  await page.locator("#exercise-modal-list .picker-row:not(.is-create)").first().click(); await page.waitForTimeout(300);
  await page.locator("#exercise-blocks .set-v1").first().fill("5");
  await page.locator("#exercise-blocks .set-v2").first().fill("275");
  await page.click("#finish-workout-btn"); await page.waitForTimeout(250); await page.click("#save-workout-btn"); await page.waitForTimeout(2500);
  const posts = db.log.filter((l) => l.method === "POST" && l.path.endsWith("/workouts"));
  check("pre-012: tried with the PR, then saved without it", posts.length >= 2 && JSON.stringify(posts[0].body).includes("highlights") && !JSON.stringify(posts[posts.length - 1].body).includes("highlights"), String(posts.length));
  check("pre-012: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();

  // nobody yet
  const solo = await open({ tweak: (d) => { d.connections = []; d.connection_requests = []; } });
  await solo.page.click('[data-tab="friends"]'); await solo.page.waitForTimeout(700);
  const t = flat(await solo.page.innerText("#friends-feed"));
  check("no friends: a welcome with Find and Invite", /Train with friends/.test(t) && /Find friends/.test(t) && /Invite a friend/.test(t), t);
  await shot(solo.page, "feed-empty");
  await solo.context.close();
});

test("Feed: signed out", async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open({ signedIn: false });
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(400);
  check("signed out: sign-in card, no add-friends icon", /Sign in to see your friends/.test(await page.innerText("#friends-feed")) && await page.locator("#friends-manage").isHidden());
  check("signed out: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
