import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("record cells do not create a Radix controller per cell", () => {
  const wrapper = section("function CellCollabVisual(", "// A dependent-filter dropdown");
  const withCollab = section("const withCollab =", "return (");

  assert.doesNotMatch(wrapper, /HoverCard|useState|useEffect/);
  assert.doesNotMatch(withCollab, /<HoverCard/);
  assert.match(withCollab, /<CellCollabVisual/);
  assert.match(source, /cellEditorsByKey\.get\(collaborationCellKey\(recordId, fieldKey\)\)/);
});

test("collaboration decoration preserves the editor subtree and accessible details", () => {
  const wrapper = section("function CellCollabVisual(", "// A dependent-filter dropdown");

  const childIndex = wrapper.indexOf("{children}");
  const activeIndex = wrapper.indexOf("{active &&");
  assert.ok(childIndex >= 0 && activeIndex > childIndex, "cell content must remain the unconditional first child");
  assert.match(wrapper, /data-testid="cell-collab-outline"/);
  assert.match(wrapper, /data-testid="cell-collab-popover"/);
  assert.match(wrapper, /data-testid="cell-conflict"/);
  assert.match(wrapper, /role="tooltip"/);
  assert.match(wrapper, /group-hover:visible/);
  assert.match(wrapper, /group-focus-within:visible/);
});