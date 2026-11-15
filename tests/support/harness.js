/**
 * Shared by every spec: where the app is, and `check`.
 *
 * `check` is one line per thing a person would notice ("badge drops to 1
 * after opening"). A failed check doesn't stop the scenario, so one run
 * reports everything that's wrong instead of only the first problem.
 */
import { expect } from "@playwright/test";
import fs from "node:fs";

export const URL_ = (process.env.GS_URL || "http://localhost:5199") + "/";

export const SCREENS = "test-results/screens";      // screenshots taken along the way
fs.mkdirSync(SCREENS, { recursive: true });

export function check(name, ok, detail = "") {
  expect.soft(Boolean(ok), name + (!ok && detail !== "" ? "  [" + String(detail).slice(0, 400) + "]" : "")).toBe(true);
}
