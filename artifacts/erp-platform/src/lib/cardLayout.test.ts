import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCardLayout, presetLayout, copyLayout, boundFieldKeys, layoutIssues, normalizeUnknownBindings, moveBlock,
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

test("blank/unknown slots and required coverage are not issues; duplicates are", () => {
  let l: CardLayout = presetLayout(fields);
  const sec = l.tabs[0].sections[0].id;
  l = insertBlock(l, sec, 0, makeBlock("field", null));
  l = insertBlock(l, sec, 0, makeBlock("field", "client"));
  l.tabs[0].sections[0].blocks = l.tabs[0].sections[0].blocks.map(b => b.fieldKey === "name" ? { ...b, modes: ["view", "edit"] } : b);
  l = insertBlock(l, sec, 0, makeBlock("relatedTable", "ghost"));
  const kinds = layoutIssues(l, fields).map(i => i.kind).sort();
  assert.deepEqual(kinds, ["duplicate"]);
  const copied = copyLayout(l, false);
  assert.deepEqual(layoutIssues(copied, fields), []);
  const norm = normalizeUnknownBindings(l, fields);
  assert.equal(norm.tabs[0].sections[0].blocks.find(b => b.kind === "relatedTable")!.fieldKey, null);
  assert.equal(normalizeUnknownBindings(copied, fields), copied);
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

// ---- rows -------------------------------------------------------------------
import {
  packRows, convertSectionToRows, addRow, removeRow, moveRow, setRowColumns, moveBlockToRow,
  moveBlockAcrossRows, removeBlock as rmBlock, layoutIssues as issuesOf, layoutIsWide, copyLayout as copyL, parseCardLayout as parseL,
} from "./cardLayout.ts";

const blk = (id: string, span = 1) => ({ id, kind: "field", fieldKey: id, span, modes: ["view", "create", "edit"], columns: [] });
const rowsLayout = () => parseL({
  version: 1, style: "standard", customStyle: {},
  tabs: [{ id: "t", title: {}, sections: [{ id: "s", title: {}, columns: 1,
    blocks: ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(x => blk(x)),
    rows: [
      { id: "r1", columns: 2, blockIds: ["a", "b"] }, { id: "r2", columns: 1, blockIds: ["c"] },
      { id: "r3", columns: 3, blockIds: ["d", "e", "f"] }, { id: "r4", columns: 2, blockIds: ["g", "h"] },
      { id: "r5", columns: 1, blockIds: ["i"] },
    ] }] }],
})!;
const sec = (l: CardLayout) => l.tabs[0].sections[0];

test("rows 2,1,3,2,1 parse intact and drive the wide flag", () => {
  const l = rowsLayout();
  assert.deepEqual(sec(l).rows!.map(r => r.columns), [2, 1, 3, 2, 1]);
  assert.equal(layoutIsWide(l), true);
  assert.deepEqual(issuesOf(l, []).filter(i => i.kind === "rowInvalid"), []);
});

test("malformed explicit rows reject the whole layout; absent rows stay legacy", () => {
  const mk = (rows: unknown, extra: Record<string, unknown> = {}) => parseL({ version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [
    { id: "s1", title: {}, columns: 1, blocks: [blk("a"), blk("b")], rows, ...extra },
  ] }] });
  assert.ok(mk([{ id: "r", columns: 2, blockIds: ["a", "b"] }]));
  assert.equal(mk(undefined)!.tabs[0].sections[0].rows, undefined);
  assert.ok(mk([{ id: "r", columns: 2, blockIds: ["a", "b"] }, { id: "r2", columns: 1, blockIds: [] }]), "empty rows allowed");
  const bad: [string, unknown][] = [
    ["not array", {}],
    ["missing block", [{ id: "r", columns: 2, blockIds: ["a"] }]],
    ["duplicate ref", [{ id: "r", columns: 2, blockIds: ["a", "a", "b"] }]],
    ["unknown ref", [{ id: "r", columns: 2, blockIds: ["a", "b", "zz"] }]],
    ["cols 0", [{ id: "r", columns: 0, blockIds: ["a", "b"] }]],
    ["cols 4", [{ id: "r", columns: 4, blockIds: ["a", "b"] }]],
    ["cols float", [{ id: "r", columns: 1.5, blockIds: ["a", "b"] }]],
    ["cols string", [{ id: "r", columns: "2", blockIds: ["a", "b"] }]],
    ["empty id", [{ id: "", columns: 2, blockIds: ["a", "b"] }]],
    ["long id", [{ id: "x".repeat(101), columns: 2, blockIds: ["a", "b"] }]],
    ["dup row id", [{ id: "r", columns: 2, blockIds: ["a"] }, { id: "r", columns: 2, blockIds: ["b"] }]],
    ["row id = block id", [{ id: "a", columns: 2, blockIds: ["a", "b"] }]],
    ["row id = section id", [{ id: "s1", columns: 2, blockIds: ["a", "b"] }]],
    ["row id = tab id", [{ id: "t", columns: 2, blockIds: ["a", "b"] }]],
    ["no blockIds", [{ id: "r", columns: 2 }]],
    ["too many", [{ id: "r", columns: 2, blockIds: ["a", "b"] }, ...Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, columns: 1, blockIds: [] }))]],
  ];
  for (const [name, rows] of bad) assert.equal(mk(rows), null, name);
  const cross = parseL({ version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [
    { id: "s1", title: {}, columns: 1, blocks: [blk("a")], rows: [{ id: "x", columns: 1, blockIds: ["a"] }] },
    { id: "s2", title: {}, columns: 1, blocks: [blk("c")], rows: [{ id: "x", columns: 1, blockIds: ["c"] }] },
  ] }] });
  assert.equal(cross, null, "row ids unique across sections");
  const blockLater = parseL({ version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [
    { id: "s1", title: {}, columns: 1, blocks: [blk("a")], rows: [{ id: "c", columns: 1, blockIds: ["a"] }] },
    { id: "s2", title: {}, columns: 1, blocks: [blk("c")] },
  ] }] });
  assert.equal(blockLater, null, "row id vs later block id");
});

test("legacy conversion packs like non-dense CSS grid", () => {
  const s = { id: "s", title: {}, columns: 2, blocks: [blk("a"), blk("b", 2), blk("c"), blk("d"), blk("e", 3)] as any };
  const rows = packRows(s);
  assert.deepEqual(rows.map(r => r.blockIds), [["a"], ["b"], ["c", "d"], ["e"]]);
  assert.ok(rows.every(r => r.columns === 2));
  const legacy = parseL({ version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [s] }] })!;
  assert.equal(sec(legacy).rows, undefined);
  assert.ok(sec(convertSectionToRows(legacy, "s")).rows);
});

test("row move/columns/delete preserve every field; blocks follow row order", () => {
  let l = rowsLayout();
  l = moveRow(l, "s", "r3", -1);
  assert.deepEqual(sec(l).blocks.map(b => b.id).join(""), "abdefcghi");
  l = setRowColumns(l, "s", "r2", 3);
  assert.equal(sec(l).rows!.find(r => r.id === "r2")!.columns, 3);
  l = removeRow(l, "s", "r1"); // first row: fields go to the row below
  assert.equal(sec(l).blocks.length, 9);
  assert.deepEqual(sec(l).rows![0].blockIds, ["a", "b", "d", "e", "f"]);
  l = removeRow(l, "s", "r5"); // fields go to the row above
  assert.deepEqual(sec(l).rows!.at(-1)!.blockIds, ["g", "h", "i"]);
  l = addRow(l, "s", 1);
  assert.deepEqual(sec(l).rows!.at(-1)!.blockIds, []);
});

test("only populated row cannot be removed", () => {
  let l = rowsLayout();
  for (const id of ["r2", "r3", "r4", "r5"]) l = removeRow(l, "s", id);
  assert.equal(sec(l).rows!.length, 1);
  assert.deepEqual(removeRow(l, "s", sec(l).rows![0].id), l);
});

test("move block between rows by DnD index and accessible controls", () => {
  let l = moveBlockToRow(rowsLayout(), "i", "s", "r1", 1);
  assert.deepEqual(sec(l).rows![0].blockIds, ["a", "i", "b"]);
  assert.deepEqual(sec(l).rows![4].blockIds, []);
  l = moveBlockToRow(l, "a", "s", "r1", 3);
  assert.deepEqual(sec(l).rows![0].blockIds, ["i", "b", "a"]);
  l = moveBlockAcrossRows(l, "c", -1);
  assert.deepEqual(sec(l).rows![0].blockIds, ["i", "b", "a", "c"]);
  l = moveBlockAcrossRows(l, "a", -1); // edge: new top row
  assert.deepEqual(sec(l).rows![0].blockIds, ["a"]);
  l = rmBlock(l, "a");
  assert.ok(!sec(l).rows!.some(r => r.blockIds.includes("a")));
  assert.deepEqual(issuesOf(l, []).filter(i => i.kind === "rowInvalid"), []);
});

test("copy keeps rows and slots with remapped ids", () => {
  const src = rowsLayout();
  for (const same of [true, false]) {
    const c = copyL(src, same);
    const s2 = sec(c);
    assert.deepEqual(s2.rows!.map(r => r.columns), [2, 1, 3, 2, 1]);
    assert.ok(s2.rows!.every(r => !r.id.startsWith("r") || r.id.startsWith("row_")));
    assert.deepEqual(s2.rows!.flatMap(r => r.blockIds), s2.blocks.map(b => b.id));
    assert.ok(!s2.blocks.some(b => b.id.length === 1));
    if (!same) assert.ok(s2.blocks.every(b => b.fieldKey === null));
  }
});

test("new presets put all fields of each section into ONE explicit row", () => {
  const many = [1, 2, 3, 4, 5].map(i => ({ fieldKey: `f${i}`, fieldType: i === 5 ? "relation" : "text", isActive: true, sortOrder: i }));
  const std = sec(presetLayout(many, "standard"));
  assert.deepEqual(std.rows!.map(r => [r.columns, r.blockIds.length]), [[1, 5]]);
  const cmp = sec(presetLayout(many, "compact"));
  assert.deepEqual(cmp.rows!.map(r => [r.columns, r.blockIds.length]), [[2, 5]]);
  const sl = presetLayout(many, "sectioned");
  assert.deepEqual(sl.tabs[0].sections.map(s => s.rows!.map(r => r.blockIds.length)), [[4], [1]]);
  for (const l of [presetLayout(many, "standard"), presetLayout(many, "compact"), sl]) {
    for (const s of l.tabs[0].sections) assert.deepEqual(s.rows!.flatMap(r => r.blockIds), s.blocks.map(b => b.id));
    assert.ok(parseCardLayout(JSON.parse(JSON.stringify(l))), "round-trips through strict parse");
    assert.deepEqual(layoutIssues(l, many).filter(i => i.kind === "rowInvalid"), []);
  }
  assert.ok(sec(presetLayout([], "standard")).rows!.length === 1);
});

test("legacy sections without rows are not converted by parse", () => {
  const raw = { version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [{ id: "s", title: {}, columns: 2, blocks: [makeBlock("text"), makeBlock("text")] }] }] };
  assert.equal(parseCardLayout(raw)!.tabs[0].sections[0].rows, undefined);
});
