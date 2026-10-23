import test from "node:test";
import assert from "node:assert/strict";
import { changesSystemPage, isReservedSystemPath } from "./system-pages";

test("personal tasks reserve their route and allow presentation edits only", () => {
  assert.equal(isReservedSystemPath("/my-tasks"), true);
  assert.equal(isReservedSystemPath("/admin/pages"), true);
  assert.equal(isReservedSystemPath("/projects"), false);
  const current = { path: "/my-tasks", isSystem: true, isActive: true, parentPageId: null };
  assert.equal(changesSystemPage(current, { nameJson: { ru: "Задачи" }, icon: "star", sortOrder: 20 }), false);
  for (const patch of [{ path: "/other" }, { isSystem: false }, { isActive: false }]) {
    assert.equal(changesSystemPage(current, patch), true);
  }
});
