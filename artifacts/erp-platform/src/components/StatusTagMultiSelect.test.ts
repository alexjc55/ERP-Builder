import assert from "node:assert/strict";
import test from "node:test";
import { applicableStatusTags, toggleStatusTagId, type StatusTag } from "./StatusTagMultiSelect.logic.ts";

const tags: StatusTag[] = [
  { id: 2, nameJson: { ru: "Готово" }, sortOrder: 2, applicableTo: ["statuses"] },
  { id: 1, nameJson: { ru: "Важно" }, sortOrder: 1, applicableTo: ["statuses"] },
  { id: 3, nameJson: { ru: "Не статус" }, sortOrder: 0, applicableTo: ["records"] },
];

test("status tag options are limited to tags used by the selected entity statuses", () => {
  assert.deepEqual(
    applicableStatusTags(tags, [{ id: 10, tagIds: [2] }]).map((tag) => tag.id),
    [2],
  );
});

test("selected tag ids survive metadata filtering for safe draft editing", () => {
  assert.deepEqual(
    applicableStatusTags(tags, [{ id: 10, tagIds: [2] }], [1]).map((tag) => tag.id),
    [1, 2],
  );
});

test("tag selection toggles are deterministic and clearable", () => {
  assert.deepEqual(toggleStatusTagId([1, 4], 1), [4]);
  assert.deepEqual(toggleStatusTagId([1, 4], 2), [1, 4, 2]);
});