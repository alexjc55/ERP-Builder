import assert from "node:assert/strict";
import test from "node:test";
import {
  refreshManualDataPaths,
  registerManualDataRefresh,
} from "./manualDataRefresh.ts";

test("manual refresh coalesces overlapping invocations", async () => {
  let calls = 0;
  let complete!: () => void;
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const unregister = registerManualDataRefresh(async () => {
    calls += 1;
    await done;
  });

  const first = refreshManualDataPaths();
  const second = refreshManualDataPaths();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);

  complete();
  await first;
  unregister();
});

test("an unregistered listener in a captured refresh snapshot is not called", async () => {
  let calls = 0;
  const unregister = registerManualDataRefresh(() => {
    calls += 1;
  });

  const refresh = refreshManualDataPaths();
  unregister();
  await refresh;

  assert.equal(calls, 0);
});