import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";

function chromiumExecutablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/collaboration",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/collaboration", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:80",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: chromiumExecutablePath(),
    },
  },
});
