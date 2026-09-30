import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { draftRelationSelections, relationDraftIds } from "./relationSelections.ts";

test("single parent and multiple children are separate normalized selections", () => {
  assert.deepEqual(draftRelationSelections([
    { fieldType: "relation", fieldKey: "order" },
    { fieldType: "relation", fieldKey: "items" },
    { fieldType: "text", fieldKey: "note" },
  ], { order: 42, items: "[101,102,101]", note: "Delivery" }), [
    { fieldKey: "order", linkedRecordIds: [42] },
    { fieldKey: "items", linkedRecordIds: [101, 102] },
  ]);
});

test("empty selection is explicit, untouched relations are omitted, and IDs are validated", () => {
  assert.deepEqual(relationDraftIds('[1,0,-2,1.5,"4",1,2]'), [1, 2]);
  assert.deepEqual(relationDraftIds(1.5), []);
  assert.deepEqual(relationDraftIds("[invalid"), []);
  assert.deepEqual(draftRelationSelections([
    { fieldType: "relation", fieldKey: "untouched" },
    { fieldType: "relation", fieldKey: "empty" },
  ], { untouched: "", empty: "[]" }), [{ fieldKey: "empty", linkedRecordIds: [] }]);
});

test("modal, inline row and shared quick-create submit relationSelections atomically", () => {
  const source = readFileSync(new URL("../components/EntityRecords.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/relationSelections: draftRelationSelections\(/g) ?? []).length, 3);
  assert.doesNotMatch(source, /await persistPendingRelationLinks/);
  assert.match(source, /f\.fieldType === "relation" && f\.dependencyConfigJson\?\.dependsOnFieldKey/);
  assert.match(source, /При смене родительской записи выбор зависимых записей будет очищен/);
});