/**
 * Comments and training together.
 *
 * Runs the real app in a phone-sized browser against the stand-in Supabase
 * in tests/support/supabase.js. Run with: npm test
 */
import { test } from "@playwright/test";
import fs from "node:fs";
import { check, URL_, SCREENS } from "./support/harness.js";
import { makeDb, install, installMaps, sessionScript, ME, MAYA, DEV, G1, G2, W1, W2 } from "./support/supabase.js";

let browser;      // set by each test: the helpers below open their pages with it
async function open({ signedIn = true, legacy9 = false, theme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const db = makeDb({ legacy9 });
  db.profiles[0].settings = { theme, customEquipment: [] };
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
const toast = (page) => page.innerText("#toast");
const flat = (t) => t.replace(/\s+/g, " ").trim();
const badge = (page) => page.evaluate(() => { const b = document.getElementById("inbox-badge"); return b.hidden ? "" : b.textContent; });
for (const theme of ["light", "dark"]) test(`Signed in (${theme})`, async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ theme });
  const T = theme + ": ";
  check(T + "badge counts the comment and the tag too (1 request + 3 + 2)", (await badge(page)) === "6", await badge(page));

  // ---------- comments: a friend's workout ----------
  await page.click('[data-tab="friends"]');
  await page.waitForTimeout(500);
  const card = flat(await page.locator(".friend-card").first().innerText());
  check(T + "feed card says who they trained with", /with you/.test(card), card);
  check(T + "feed card shows the comment count", (await page.locator(".friend-card .comment-chip .react-n").innerText()) === "1");
  await shot(page, `p3-${theme}-1-feed`);
  await page.click(".friend-card .comment-chip");
  await page.waitForTimeout(400);
  let body = flat(await page.innerText("#list-modal-body"));
  check(T + "speech bubble opens the workout with its thread", /COMMENTS \(1\) DP Dev Patel 1h nice session/i.test(body), body);
  check(T + "detail shows who was there", /With you/.test(body), body);
  check(T + "a friend's comment has no Delete for me", (await page.locator("#list-modal-body .comment-del").count()) === 0);
  await page.fill("#comment-input", "let's go <b>big</b>");
  await page.press("#comment-input", "Enter");
  await page.waitForTimeout(700);
  const posted = db.comments[db.comments.length - 1];
  check(T + "comment saved to the right workout", posted.workout_id === W2 && posted.user_id === ME && posted.body === "let's go <b>big</b>", JSON.stringify(posted));
  body = flat(await page.innerText("#list-modal-body"));
  check(T + "comment shown, as text not markup", /COMMENTS \(2\)/i.test(body) && /You now let's go <b>big<\/b> Delete|You now Delete let's go <b>big<\/b>/.test(body) && (await page.locator("#list-modal-body .comment-text b").count()) === 0, body);
  check(T + "box is empty again and still there", (await page.inputValue("#comment-input")) === "");
  await shot(page, `p3-${theme}-2-thread`);
  // failure keeps what you typed
  db.failComment = true;
  await page.fill("#comment-input", "second try");
  await page.click(".comment-send");
  await page.waitForTimeout(600);
  check(T + "refused comment: reason shown, text kept, nothing added", /Only friends can comment/.test(await toast(page)) && (await page.inputValue("#comment-input")) === "second try" && (await page.locator("#list-modal-body .comment").count()) === 2, await toast(page));
  db.failComment = false;
  // delete mine
  await page.locator("#list-modal-body .comment-del").click();
  await page.waitForTimeout(500);
  check(T + "deleting my comment removes it everywhere", !db.comments.some((c) => c.user_id === ME) && (await page.locator("#list-modal-body .comment").count()) === 1);
  await page.click("#list-modal-close");
  check(T + "feed count back to 1", (await page.locator(".friend-card .comment-chip .react-n").innerText()) === "1");

  // ---------- comments: my own workout ----------
  await page.click('[data-tab="profile"]');
  await page.waitForTimeout(300);
  await page.locator("#profile-workouts [data-workout], #profile-workouts button, #profile-workouts .workout-card").first().click().catch(() => {});
  await page.waitForTimeout(300);
  if (!(await page.locator("#list-modal-overlay.open").count())) { await page.evaluate(() => 0); }
  body = (await page.locator("#list-modal-overlay.open").count()) ? flat(await page.innerText("#list-modal-body")) : "";
  if (!/Leg Day/.test(body)) {
    // fall back to the Inbox route to my workout
    await page.click("#open-inbox"); await page.waitForTimeout(700);
    await page.locator('.inbox-row[data-inbox-wk="' + W1 + '"]').first().click(); await page.waitForTimeout(300);
    body = flat(await page.innerText("#list-modal-body"));
  }
  check(T + "my workout shows the thread and lets me delete a friend's comment", /COMMENTS \(1\) MJ Maya Jensen 30m Delete 245 for 5\?\? strong/i.test(body), body);
  await page.locator("#list-modal-body .comment-del").click();
  await page.waitForTimeout(500);
  check(T + "owner delete goes through", !db.comments.some((c) => c.workout_id === W1));
  await page.click("#list-modal-close");

  // ---------- inbox ----------
  await page.reload(); await page.waitForTimeout(2600);
  db.comments.push({ id: "cccccccc-0000-4000-8000-000000000009", workout_id: W1, user_id: MAYA, body: "245 for 5?? strong", created_at: new Date(Date.now() - 30 * 60000).toISOString() });
  await page.click("#open-inbox");
  await page.waitForTimeout(1200);
  body = flat(await page.innerText("#list-modal-body"));
  check(T + "inbox: comment with a quote", /Maya Jensen commented on your Leg Day ?“245 for 5\?\? strong”/.test(body), body);
  check(T + "inbox: tag with both buttons", /Maya Jensen tagged you in Push Day 20m Add to my log Dismiss/.test(body), body);
  await shot(page, `p3-${theme}-3-inbox`);

  if (theme === "light") {
    // ---------- add to my log ----------
    await page.click("[data-tag-add]");
    await page.waitForTimeout(700);
    check(T + "add to my log: on the log screen", (await page.locator("#screen-log.active").count()) === 1 && /Added from Maya/.test(await toast(page)), await toast(page));
    const theirs = db.workouts.find((w) => w.id === W2);
    const d = new Date(theirs.performed_at);
    const pad = (n) => String(n).padStart(2, "0");
    check(T + "…dated and timed like theirs", (await page.inputValue("#log-date")) === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` && (await page.inputValue("#log-start")) === `${pad(d.getHours())}:${pad(d.getMinutes())}`, await page.inputValue("#log-date") + " " + await page.inputValue("#log-start"));
    check(T + "…at their gym", (await page.inputValue("#log-gym")) === G1);
    check(T + "…with them tagged back", flat(await page.innerText("#log-with")) === "MJ Maya × + Tag a friend", flat(await page.innerText("#log-with")));
    check(T + "…their exercise and title filled in", /Bench Press/.test(await page.innerText("#exercise-blocks")) && (await page.inputValue("#log-title")) === "Push Day");
    await shot(page, `p3-${theme}-4-addtolog`);
    // tag picker: add Dev too
    await page.click("#log-with-add");
    await page.waitForTimeout(300);
    check(T + "tag picker lists friends with Maya ticked", (await page.locator(".tag-row").count()) === 2 && (await page.locator(".tag-row.is-on").count()) === 1);
    await page.locator(".tag-row", { hasText: "Dev Patel" }).click();
    await page.click("#tag-done");
    check(T + "second friend tagged", flat(await page.innerText("#log-with")) === "MJ Maya × DP Dev × + Tag a friend", flat(await page.innerText("#log-with")));
    await page.locator('[data-untag="' + DEV + '"]').click();
    check(T + "tap a chip to untag", flat(await page.innerText("#log-with")) === "MJ Maya × + Tag a friend");
    await page.click("#log-with-add"); await page.locator(".tag-row", { hasText: "Dev Patel" }).click(); await page.click("#tag-done");
    await page.click("#save-workout-btn");
    await page.waitForTimeout(3000);
    const tagPosts = db.log.filter((l) => l.method === "POST" && l.path.endsWith("/workout_tags"));
    const mineNew = db.log.filter((l) => l.method === "POST" && l.path.endsWith("/workouts")).pop();
    check(T + "saved workout tags both friends, once", tagPosts.length === 1 && tagPosts[0].body.length === 2 && tagPosts[0].body.every((b) => b.workout_id === mineNew.body.id) && tagPosts[0].body.map((b) => b.user_id).sort().join() === [MAYA, DEV].sort().join(), JSON.stringify(tagPosts.map((t) => t.body)));
    await shot(page, "p3-debug-aftersave");
    if (await page.locator("#confirm-overlay.open").count()) await page.click("#confirm-no");
    if (await page.locator("#summary-done").isVisible()) await page.click("#summary-done");
    // a later sync must not re-send the tags (that would notify them again)
    await page.reload(); await page.waitForTimeout(3500);
    check(T + "tags aren't re-sent on the next sync", db.log.filter((l) => l.method === "POST" && l.path.endsWith("/workout_tags")).length === 1 && db.log.filter((l) => l.method === "POST" && l.path.endsWith("/workouts")).length === 1, db.log.filter((l) => l.method === "POST").map((l) => l.path).join(","));
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem("gymsocial_v1")));
    check(T + "the tag is settled (synced in settings)", st.settings.tagsDone && st.settings.tagsDone[W2] === true && db.profiles[0].settings.tagsDone && db.profiles[0].settings.tagsDone[W2] === true, JSON.stringify(db.profiles[0].settings.tagsDone));
    await page.click("#open-inbox"); await page.waitForTimeout(900);
    check(T + "inbox: the tag no longer offers buttons", (await page.locator("[data-tag-add]").count()) === 0 && /tagged you in Push Day/.test(await page.innerText("#list-modal-body")));
    await page.click("#list-modal-close");
    await page.click('[data-tab="home"]'); await page.waitForTimeout(300);
  } else {
    // ---------- dismiss ----------
    await page.click("[data-tag-skip]");
    await page.waitForTimeout(400);
    check(T + "dismiss: stays in the Inbox, buttons gone, no log screen", (await page.locator("#inbox-root").count()) === 1 && (await page.locator("[data-tag-add]").count()) === 0 && (await page.locator("#screen-log.active").count()) === 0);
    await page.click("#list-modal-close");
  }
  check(T + "no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});

// ---------- database that hasn't run 009 ----------
test("Database that hasn't run 009", async ({ browser: b }) => {
  browser = b;
  const { context, page, db, errors } = await open({ legacy9: true });
  await page.click('[data-tab="friends"]'); await page.waitForTimeout(500);
  check("pre-009: no comment bubbles, reactions still there", (await page.locator(".comment-chip").count()) === 0 && (await page.locator(".friend-card .feed-react").count()) >= 1);
  await page.locator(".friend-open").first().click(); await page.waitForTimeout(300);
  check("pre-009: no comment box in a workout", (await page.locator("#comment-form").count()) === 0 && (await page.locator(".comments").count()) === 0);
  await page.click("#list-modal-close");
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  check("pre-009: no With field when logging", await page.locator("#log-with-field").isHidden());
  await page.click("#log-cancel");
  check("pre-009: badge is the Phase 1 number", (await badge(page)) === "4", await badge(page));
  await page.click("#open-settings"); await page.waitForTimeout(300);
  const line = await page.locator("#sync-line").count() ? await page.innerText("#sync-line") : "";
  check("pre-009: sync is healthy", !/Couldn't sync|Offline/.test(line), line);
  check("pre-009: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
// ---------- signed out ----------
test("Signed out", async ({ browser: b }) => {
  browser = b;
  const { context, page, errors } = await open({ signedIn: false });
  await page.click('[data-tab="log"]'); await page.waitForTimeout(300);
  check("signed out: no With field", await page.locator("#log-with-field").isHidden());
  check("signed out: no comment bubbles anywhere", (await page.locator(".comment-chip").count()) === 0);
  check("signed out: no console errors", errors.length === 0, errors.join(" || "));
  await context.close();
});
