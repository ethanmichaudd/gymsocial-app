/**
 * Browser tests: `npm test`.
 *
 * Starts the app on its own port (5199, so it never collides with
 * `npm run dev` on 5173), opens it at iPhone size, and runs every spec in
 * tests/ against a stand-in Supabase. Nothing here talks to the real
 * database or to OpenStreetMap.
 *
 * First time only:  npm install  &&  npx playwright install chromium
 */
import { defineConfig } from "@playwright/test";

const PORT = 5199;

export default defineConfig({
  testDir: "tests",
  timeout: 5 * 60 * 1000,          // each test is a whole scenario, with real waits for sync
  workers: process.env.CI ? 1 : 2,
  reporter: [["list"]],
  use: {
    // PW_CHANNEL=chrome uses the Chrome already on the machine instead of Playwright's own browser
    channel: process.env.PW_CHANNEL || undefined,
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60 * 1000,
  },
});
