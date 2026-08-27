import assert from "node:assert/strict";
import test from "node:test";
import { isManualStatusEditDisabled } from "./status-manual-edit";

test("manual status edit policy applies to all users without an admin bypass", () => {
  assert.equal(isManualStatusEditDisabled("allowed", [7], 7), false);
  assert.equal(isManualStatusEditDisabled("disabled_all", [], 7), true);
  assert.equal(isManualStatusEditDisabled("disabled_users", [7, 8], 7), true);
  assert.equal(isManualStatusEditDisabled("disabled_users", [8], 7), false);
});

test("malformed legacy user id metadata fails open unless policy disables all", () => {
  assert.equal(isManualStatusEditDisabled("disabled_users", null, 7), false);
  assert.equal(isManualStatusEditDisabled("disabled_users", ["7"], 7), false);
  assert.equal(isManualStatusEditDisabled("disabled_all", null, 7), true);
});