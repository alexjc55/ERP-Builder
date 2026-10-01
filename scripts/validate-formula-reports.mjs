#!/usr/bin/env node
import { runValidationProcess } from "./run-validation-process.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const suites = [
  ["test:dashboard-chart-formulas-db", "RUN_DASHBOARD_CHART_DB", "DASHBOARD_CHART_DEV_FINGERPRINT"],
  ["test:dashboard-formula-metrics-db", "RUN_DASHBOARD_FORMULA_DB", "DASHBOARD_FORMULA_DEV_FINGERPRINT"],
  ["test:pivot-formula-tags-db", "RUN_PIVOT_FORMULA_DB", "PIVOT_FORMULA_DEV_FINGERPRINT"],
];

// Fail closed if the runner output is missing, duplicated or incomplete.
export function assertExecuted(output) {
  const counts = {};
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const matches = [...text.matchAll(new RegExp(`^(?:#|ℹ)\\s+${key}\\s+(\\d+)\\s*$`, "gm"))];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous test summary: ${key}`);
    counts[key] = Number(matches[0][1]);
    if (!Number.isSafeInteger(counts[key])) throw new Error(`Invalid counter: ${key}`);
  }
  if (counts.tests === 0 || counts.pass !== counts.tests ||
      counts.fail || counts.cancelled || counts.skipped || counts.todo) {
    throw new Error(`Tests were not fully executed successfully: ${JSON.stringify(counts)}`);
  }
  return counts;
}

function runPackage(script, env) {
  // Each package command owns the shared lock. Never wrap this orchestrator in it.
  return runValidationProcess("corepack", ["pnpm", "--filter", "@workspace/api-server", "run", script], {
    cwd: root, env,
  });
}

export async function runValidation({ env = process.env, run = runPackage } = {}) {
  const fingerprint = env.FORMULA_REPORTS_DEV_FINGERPRINT;
  if (env.FORMULA_REPORTS_CONFIRMED_DEVELOPMENT !== "1" ||
      !/^[a-f0-9]{32}$/.test(fingerprint ?? "")) {
    throw new Error("Confirm the development database independently, then supply FORMULA_REPORTS_CONFIRMED_DEVELOPMENT=1 and FORMULA_REPORTS_DEV_FINGERPRINT (32 lowercase hex digits). No tests started.");
  }
  const results = [];
  for (const [script, optIn, identity] of suites) {
    const child = await run(script, {
      ...env, [optIn]: "1", [identity]: fingerprint,
      FORCE_COLOR: "0", NODE_DISABLE_COLORS: "1",
    });
    if (child.error || child.signal || child.status !== 0) {
      // Do not echo arbitrary child diagnostics: DB driver errors can contain secrets.
      throw new Error(`${script} failed (exit ${child.status}, signal ${child.signal ?? "none"}). No later suite started. If interrupted, fixture cleanup is not guaranteed; inspect the confirmed development database before retrying.`);
    }
    try {
      results.push({ script, ...assertExecuted(child.stdout ?? "") });
    } catch (error) {
      throw new Error(`${script}: ${error.message}`);
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const result of await runValidation()) console.log(`${result.script}: ${result.pass} passed, zero skipped`);
    console.log("Formula report readiness: PASS");
  } catch (error) {
    console.error(`Formula report readiness: NOT VERIFIED — ${error.message}`);
    process.exitCode = 1;
  }
}