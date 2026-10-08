import assert from "node:assert/strict";
import test from "node:test";
import { invalidateCurrentSession } from "./sessionLifecycle.ts";

test("a rejected session is removed once; delayed failures preserve the new identity", () => {
  let token: string | null = "old";
  let invalidations = 0;
  const storage = { getItem: () => token, removeItem: () => { token = null; } };
  const reset = () => { invalidations++; };
  assert.equal(invalidateCurrentSession(storage, "old", reset), true);
  assert.equal(token, null);
  assert.equal(invalidateCurrentSession(storage, "old", reset), false);
  assert.equal(invalidations, 1);
  token = "new";
  assert.equal(invalidateCurrentSession(storage, "old", reset), false);
  assert.equal(token, "new");
  assert.equal(invalidations, 1);
});
