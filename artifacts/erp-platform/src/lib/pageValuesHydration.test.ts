import assert from "node:assert/strict";
import test from "node:test";
import {
  canWritePageValues,
  pageValuesHydrationKey,
  runPageValueWrite,
  type PageValuesHydrationState,
} from "./pageValuesHydration.ts";

test("delayed page-value hydration cannot write from an empty map", async () => {
  const key = pageValuesHydrationKey(119, [4164, 4165]);
  let state: PageValuesHydrationState = { status: "loading", key, error: null };
  let writes = 0;
  let release!: () => void;
  const hydration = new Promise<void>((resolve) => { release = resolve; }).then(() => {
    state = { status: "ready", key, error: null };
  });

  assert.equal(runPageValueWrite(state, key, () => { writes += 1; }), false);
  assert.equal(writes, 0);
  release();
  await hydration;
  assert.equal(runPageValueWrite(state, key, () => { writes += 1; }), true);
  assert.equal(writes, 1);
});

test("rejected or stale page-value hydration remains write-closed", async () => {
  const key = pageValuesHydrationKey(119, [4164]);
  let state: PageValuesHydrationState = { status: "loading", key, error: null };
  await Promise.reject(new Error("Request failed")).catch((error: unknown) => {
    state = {
      status: "error",
      key,
      error: error instanceof Error ? error.message : String(error),
    };
  });
  let writes = 0;
  assert.equal(runPageValueWrite(state, key, () => { writes += 1; }), false);
  assert.equal(canWritePageValues({ status: "ready", key, error: null }, pageValuesHydrationKey(120, [4164])), false);
  assert.equal(writes, 0);
});