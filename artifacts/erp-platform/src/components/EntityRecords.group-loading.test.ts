import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");
test("group expansion is absent from the server query and its dependencies", () => {
  const query = source.slice(source.indexOf("const recordQuery:"), source.indexOf("// Pivot ("));
  assert.match(query, /groupedQueryOptions\(groupingActive\)/);
  assert.doesNotMatch(query, /expandAll|groupExceptions|groupValue/);
  assert.match(query, /page,\s+pageSize,/);
});
test("both header and global toggles are local with no page reset or spinner", () => {
  const header = source.slice(source.indexOf("const renderGroupRow ="), source.indexOf("const renderGroupRow =") + 1500);
  assert.match(header, /setGroupExceptions/);
  assert.doesNotMatch(header, /setPage|Loader2|groupBusy|runQuery/);
  const toolbar = source.slice(source.indexOf("setExpandAll(!(expandAll"), source.indexOf("setExpandAll(!(expandAll") + 400);
  assert.match(toolbar, /setGroupExceptions\(new Set\(\)\)/);
  assert.doesNotMatch(toolbar, /setPage|runQuery/);
});
test("page and permission changes still clear scoped rows, groups and totals", () => {
  const reset = source.slice(source.indexOf("const recordsRenderKey ="), source.indexOf("// Start each row-dependent"));
  assert.match(reset, /recordsPermissionScopeKey/);
  assert.match(reset, /setRecords\(\[\]\)/);
  assert.match(reset, /setGroups\(null\)/);
  assert.match(reset, /setTotalsResultKey\(null\)/);
  assert.doesNotMatch(reset, /accordionOnly/);
  assert.match(source, /groupRowsReady = !showGroups \|\| loadedGroupSig === queryKey/);
  assert.doesNotMatch(source, /expandedGroupIndex|groupValue|fullFilteredGroupTotals/);
});