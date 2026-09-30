import { strict as assert } from "node:assert";
import { test } from "node:test";
import { moveMirrorColumn, orderMirrorColumns } from "./mirrorColumnOrder.ts";

const base = [
  { kind: "entity" as const, token: "e:first", field: { sortOrder: 1 } },
  { kind: "entity" as const, token: "e:second", field: { sortOrder: 2 } },
  { kind: "status" as const, token: "__status__" },
  { kind: "page" as const, token: "p:notes" },
];
const tokens = (columns: typeof base) => columns.map(c => c.token);

test("status can move between entity and page fields and persist in a mirror order", () => {
  const initial = orderMirrorColumns(base, ["e:first", "p:notes", "e:second"], 2);
  assert.deepEqual(tokens(initial), ["e:first", "p:notes", "e:second", "__status__"]);
  const saved = moveMirrorColumn(initial, 3, -1);
  assert.deepEqual(saved, ["e:first", "p:notes", "__status__", "e:second"]);
  assert.deepEqual(tokens(orderMirrorColumns(base, saved, 2)), saved);
  const further = moveMirrorColumn(orderMirrorColumns(base, saved, 2), 2, -1);
  assert.deepEqual(tokens(orderMirrorColumns(base, further, 2)), further);
  assert.deepEqual(moveMirrorColumn(orderMirrorColumns(base, further, 2), 0, -1), further);
});

test("hidden status and newly added columns do not corrupt the saved order", () => {
  const saved = ["e:first", "__status__", "p:notes", "e:second"];
  assert.deepEqual(tokens(orderMirrorColumns(base.filter(c => c.kind !== "status"), saved, 2)),
    ["e:first", "p:notes", "e:second"]);
  assert.deepEqual(tokens(orderMirrorColumns(base, saved, 2)), saved);
  assert.deepEqual(tokens(orderMirrorColumns([...base, { kind: "page", token: "p:new" }], saved, 2)),
    [...saved, "p:new"]);
});