import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertExecuted, runValidation } from "./validate-formula-reports.mjs";

const summary = (changes = {}, prefix = "#") => Object.entries({
  tests: 6, pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...changes,
}).map(([key, value]) => `${prefix} ${key} ${value}`).join("\n");
const env = {
  FORMULA_REPORTS_CONFIRMED_DEVELOPMENT: "1",
  FORMULA_REPORTS_DEV_FINGERPRINT: "a".repeat(32),
};

test("accepts complete TAP and colored spec summaries", () => {
  assert.equal(assertExecuted(summary()).pass, 6);
  assert.equal(assertExecuted(`\u001b[32m${summary({}, "ℹ")}\u001b[0m`).tests, 6);
});

for (const [name, output] of Object.entries({
  skipped: summary({ pass: 5, skipped: 1 }),
  failed: summary({ pass: 5, fail: 1 }),
  cancelled: summary({ pass: 5, cancelled: 1 }),
  todo: summary({ pass: 5, todo: 1 }),
  empty: "",
  zero: summary({ tests: 0, pass: 0 }),
  mismatch: summary({ pass: 3 }),
  truncated: summary().replace("# todo 0", ""),
  duplicate: `${summary()}\n# tests 6`,
  malformed: summary({ tests: "six" }),
})) {
  test(`rejects ${name} results`, () => assert.throws(() => assertExecuted(output)));
}

test("missing or invalid independent confirmation never launches fixtures", async () => {
  for (const candidate of [
    {}, { ...env, FORMULA_REPORTS_CONFIRMED_DEVELOPMENT: "0" },
    { ...env, FORMULA_REPORTS_DEV_FINGERPRINT: "" },
    { ...env, FORMULA_REPORTS_DEV_FINGERPRINT: "not a fingerprint" },
  ]) {
    let calls = 0;
    await assert.rejects(runValidation({ env: candidate, run: () => { calls++; } }));
    assert.equal(calls, 0);
  }
});

test("runs the three guarded package commands strictly sequentially", async () => {
  const calls = [];
  let running = false;
  const result = await runValidation({ env, run: async (script, childEnv) => {
    assert.equal(running, false);
    running = true;
    calls.push([script, childEnv]);
    await new Promise(resolve => setTimeout(resolve, 1));
    running = false;
    return { status: 0, stdout: summary(), stderr: "" };
  } });
  assert.deepEqual(calls.map(([name]) => name), [
    "test:dashboard-chart-formulas-db", "test:dashboard-formula-metrics-db", "test:pivot-formula-tags-db",
  ]);
  for (const [index, [optIn, fingerprint]] of [
    ["RUN_DASHBOARD_CHART_DB", "DASHBOARD_CHART_DEV_FINGERPRINT"],
    ["RUN_DASHBOARD_FORMULA_DB", "DASHBOARD_FORMULA_DEV_FINGERPRINT"],
    ["RUN_PIVOT_FORMULA_DB", "PIVOT_FORMULA_DEV_FINGERPRINT"],
  ].entries()) {
    assert.equal(calls[index][1][optIn], "1");
    assert.equal(calls[index][1][fingerprint], env.FORMULA_REPORTS_DEV_FINGERPRINT);
  }
  assert.equal(result.length, 3);
  assert.equal(Object.keys(env).length, 2);
});

for (const failure of [
  { status: 1 }, { status: null }, { status: 0, signal: "SIGTERM" },
  { status: 0, error: new Error("spawn failed") },
  { status: 0, stdout: summary({ pass: 5, skipped: 1 }) },
  { status: 0, stdout: "" },
]) {
  test(`stops after failure ${JSON.stringify(failure)}`, async () => {
    let calls = 0;
    await assert.rejects(runValidation({ env, run: () => {
      calls++;
      return { stdout: summary(), stderr: "do not expose credentials", ...failure };
    } }), error => !error.message.includes("credentials"));
    assert.equal(calls, 1);
  });
}

test("CLI without confirmation exits nonzero and does not claim PASS", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-formula-reports.mjs"], {
    encoding: "utf8", env: { ...process.env, FORMULA_REPORTS_CONFIRMED_DEVELOPMENT: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NOT VERIFIED/);
  assert.doesNotMatch(result.stdout, /PASS/);
});