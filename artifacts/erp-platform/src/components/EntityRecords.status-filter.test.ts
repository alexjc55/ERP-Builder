import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");
const filter = source.slice(
  source.indexOf("{filterableStatuses.length > 0 && ("),
  source.indexOf("{filterableFields.map(", source.indexOf("{filterableStatuses.length > 0 && (")),
);

test("status quick filter displays server-selected tags and full wrapping names without changing selection", () => {
  assert.match(filter, /filterableStatuses\.map\(\(s: Status\) => \(/);
  assert.match(filter, /<CompactStatus[^>]*name=\{ml\(s\.nameJson\)\}[^>]*displayTags=\{s\.displayTags\}[^>]*ml=\{ml\}/);
  assert.match(filter, /checked=\{statusFilter\.includes\(s\.id\)\} onCheckedChange=\{\(\) => toggleStatus\(s\.id\)\}/);
  assert.doesNotMatch(filter, /className="truncate">\{ml\(s\.nameJson\)\}/);
  assert.match(filter, /className="w-72 max-w-\[calc\(100vw-2rem\)\]/);
});