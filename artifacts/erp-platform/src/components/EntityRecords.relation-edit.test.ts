import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");

test("relation edits forward the server version into the next record save", () => {
  assert.match(
    source,
    /const handleRelationChanged = \(version\?: number\) => \{[\s\S]*?onRelationChanged\?\.\(version\);/,
  );
  assert.match(source, /editingVersionRef\.current = version;/);
  assert.match(
    source,
    /expectedVersion: editingVersionRef\.current \?\? editing\.version/,
  );
  assert.match(source, /draftVersionRef\.current = version;/);
  assert.match(
    source,
    /expectedVersion: draftVersionRef\.current \?\? draftVersion \?\? record\.version/,
  );
});

test("record save stays blocked while an edit-mode relation picker is open", () => {
  assert.match(
    source,
    /disabled=\{isPending \|\| dialogRelationEditing\}/,
  );
  assert.match(
    source,
    /disabled=\{submitting \|\| loading \|\| relationEditing\}/,
  );
  assert.match(
    source,
    /onEditingChange=\{\(open\) => onRelationEditingChange\?\.\(open\)\}/,
  );
  assert.match(
    source,
    /onOpenChange=\{\(nextOpen\) => \{[\s\S]*?if \(!nextOpen\) onEditingChange\(false\);/,
  );
  assert.match(
    source,
    /void choose\(newId\)\.finally\(\(\) => onEditingChange\(false\)\);/,
  );
});

test("same-entity page changes refetch permission-scoped rows and relation values", () => {
  assert.match(
    source,
    /\[entityId, queryKey, refreshTick, permPageId\]/,
  );
  assert.match(
    source,
    /\[entityId, hasEntityRelationFields, recordIdsKey, entityRelationFieldsKey, refreshTick, permPageId\]/,
  );
  assert.match(
    source,
    /\[mode, recordId, entityId, pageId, relTick\]/,
  );
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{[\s\S]*?setRecords\(\[\]\);[\s\S]*?setEntityRelatedByRecord\(new Map\(\)\);[\s\S]*?\}, \[entityId, permPageId\]\);/,
  );
});