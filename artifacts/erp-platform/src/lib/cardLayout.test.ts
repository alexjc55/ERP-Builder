import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCardLayout, presetLayout, copyLayout, boundFieldKeys, layoutIssues, moveBlock,
  makeBlock, insertBlock, cardStyleVars, type CardLayout,
} from "./cardLayout.ts";

const fields = [
  { fieldKey: "name", fieldType: "text", isActive: true, sortOrder: 1, isRequired: true },
  { fieldKey: "client", fieldType: "relation", isActive: true, sortOrder: 2 },
  { fieldKey: "old", fieldType: "text", isActive: false, sortOrder: 3 },
];

test("standard preset keeps every active field in order, single column", () => {
  const l = presetLayout(fields, "standard");
  assert.equal(l.tabs.length, 1);
  assert.equal(l.tabs[0].sections[0].columns, 1);
  assert.deepEqual(l.tabs[0].sections[0].blocks.map(b => b.fieldKey), ["name", "client"]);
  assert.deepEqual(cardStyleVars(l), {});
});

test("sectioned preset splits relations into a separate section", () => {
  const l = presetLayout(fields, "sectioned");
  assert.equal(l.tabs[0].sections.length, 2);
  assert.deepEqual(l.tabs[0].sections[1].blocks.map(b => b.fieldKey), ["client"]);
});

test("copy to another entity keeps shape and clears bindings", () => {
  const src = presetLayout(fields, "sectioned");
  src.tabs[0].sections[0].blocks.push({ ...makeBlock("text"), text: { ru: "Примечание" } });
  const copy = copyLayout(src, false);
  assert.equal(copy.tabs[0].sections.length, src.tabs[0].sections.length);
  assert.equal(copy.tabs[0].sections[0].blocks.length, src.tabs[0].sections[0].blocks.length);
  assert.equal(boundFieldKeys(copy).size, 0);
  assert.equal(copy.tabs[0].sections[0].blocks.at(-1)?.text?.ru, "Примечание");
  assert.notEqual(copy.tabs[0].id, src.tabs[0].id);
  assert.equal(boundFieldKeys(src).size, 2, "source untouched");
});

test("copy within entity keeps bindings with fresh ids", () => {
  const src = presetLayout(fields);
  const copy = copyLayout(src, true);
  assert.deepEqual([...boundFieldKeys(copy)], ["name", "client"]);
  assert.notEqual(copy.tabs[0].sections[0].blocks[0].id, src.tabs[0].sections[0].blocks[0].id);
});

test("issues report empty slots, duplicates and missing required create fields", () => {
  let l: CardLayout = presetLayout(fields);
  const sec = l.tabs[0].sections[0].id;
  l = insertBlock(l, sec, 0, makeBlock("field", null));
  l = insertBlock(l, sec, 0, makeBlock("field", "client"));
  l.tabs[0].sections[0].blocks = l.tabs[0].sections[0].blocks.map(b => b.fieldKey === "name" ? { ...b, modes: ["view", "edit"] } : b);
  const kinds = layoutIssues(l, fields).map(i => i.kind).sort();
  assert.deepEqual(kinds, ["duplicate", "emptySlot", "requiredMissing"]);
});

test("moveBlock within a section respects drop-before semantics", () => {
  const l = presetLayout([...fields, { fieldKey: "c", fieldType: "text", isActive: true, sortOrder: 4 }]);
  const sec = l.tabs[0].sections[0];
  const moved = moveBlock(l, sec.blocks[0].id, sec.id, 2);
  assert.deepEqual(moved.tabs[0].sections[0].blocks.map(b => b.fieldKey), ["client", "name", "c"]);
});

test("parse rejects malformed layouts and normalizes defaults", () => {
  assert.equal(parseCardLayout(null), null);
  assert.equal(parseCardLayout({ version: 2, tabs: [] }), null);
  const parsed = parseCardLayout({ version: 1, tabs: [{ id: "t", title: {}, sections: [{ id: "s", title: {}, columns: 9, blocks: [{ id: "b", kind: "field", fieldKey: "x" }] }] }] });
  assert.equal(parsed?.style, "standard");
  assert.equal(parsed?.tabs[0].sections[0].columns, 3);
  assert.deepEqual(parsed?.tabs[0].sections[0].blocks[0].modes, ["view", "create", "edit"]);
});
