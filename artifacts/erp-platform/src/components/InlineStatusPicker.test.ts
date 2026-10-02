import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const table = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");
const status = readFileSync(new URL("./InlineStatusPicker.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("./InlineListPicker.tsx", import.meta.url), "utf8");

test("inline status uses the non-modal keyboard list while preserving status tags and workflows", () => {
  const branch = table.slice(table.indexOf('<InlineStatusPicker'), table.indexOf('<InlineSavingIndicator', table.indexOf('<InlineStatusPicker')));
  assert.doesNotMatch(branch, /<Select|SelectContent/);
  assert.match(branch, /allowedStatusesForRecord\(record\)/);
  assert.match(branch, /!workflowActiveForRecord\(record\)/);
  assert.match(branch, /<CompactStatus.*displayTags=\{s\.displayTags\}/);
  assert.match(branch, /onCommit=\{v => commitStatus\(record, v\)\}/);
  assert.match(list, /modal=\{false\}/);
  assert.match(list, /option\.content \?\? option\.label/);
  assert.match(list, /options\[next\]\.label\.toLocaleLowerCase\(\)\.startsWith\(prefix\)/);
});

test("status selection keeps the ACK-first editor alive before pending props are painted", () => {
  assert.match(status, /selected\.current = true;\s*onCommit\(value\)/);
  assert.match(status, /else if \(!selected\.current && !pending\) onCancel\(\)/);
  assert.match(status, /if \(open\) selected\.current = false/);
  const commit = table.slice(table.indexOf("const commitStatus ="), table.indexOf("const commitPageCell ="));
  assert.match(commit, /expectedVersion: record\.version/);
  assert.match(commit, /beginInlineWrite/);
});

test("retained authorized relation snapshots keep candidates mounted but cannot bypass hydration write guards", () => {
  const branch = table.slice(table.indexOf("const relAssignable ="), table.indexOf("// A dependent-filter dropdown"));
  assert.match(branch, /keepRelationPickerMounted = inlineEditEnabled && !!meta\?\.editableColumn && !!rel\?\.editable/);
  assert.match(branch, /disabled=\{!relAssignable\}/);
  assert.match(branch, /pageRelationsProjectionState === "ready"/);
  assert.doesNotMatch(branch, /keepRelationPickerMounted = (?:isEditingThis|relationIsEditingThis)/);
});