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

const baseURL = process.env.INLINE_EDITOR_PROFILE_BASE_URL;
if (!baseURL) {
  throw new Error(
    "INLINE_EDITOR_PROFILE_BASE_URL is required; use the isolated production profile runner",
  );
}
const target = new URL(baseURL);
if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
  throw new Error("Inline editor checks require an isolated loopback static server, never a live deployment");
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/inline-editor-profile/playwright",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  use: {
    baseURL,
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: chromiumExecutablePath(),
    },
  },
});