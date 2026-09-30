import { test } from "node:test";
import assert from "node:assert/strict";
import { fullFilteredGroupTotals, isGroupExpanded, toggleCollapsedGroup } from "./groupAccordion.ts";

test("expand all -> close A leaves B open; reopen A; close B; reset expands all", () => {
  let collapsed = new Set<string>();
  const open = (key: string) => isGroupExpanded(true, collapsed, undefined, key);
  collapsed = toggleCollapsedGroup(collapsed, "A");
  assert.equal(open("A"), false);
  assert.equal(open("B"), true);
  collapsed = toggleCollapsedGroup(collapsed, "A");
  assert.equal(open("A"), true);
  collapsed = toggleCollapsedGroup(collapsed, "B");
  assert.equal(open("A"), true);
  assert.equal(open("B"), false);
  collapsed = new Set();
  assert.equal(open("A"), true);
  assert.equal(open("B"), true);
  assert.equal(isGroupExpanded(false, collapsed, undefined, "A"), false);
  assert.equal(isGroupExpanded(false, collapsed, undefined, "B"), false);
});

test("group-local exclusions do not mutate selection/query or full numeric totals", () => {
  const query = { grouped: true, withRowGroups: true, page: 3 };
  const key = JSON.stringify(query);
  const totals = fullFilteredGroupTotals([{ sums: { amount: 30 } }, { sums: { amount: 70 } }], { amount: 100 }, false);
  toggleCollapsedGroup(new Set(), "A");
  assert.equal(JSON.stringify(query), key);
  assert.deepEqual(totals, { amount: 100 });
});

test("server totals preserve percent averages, formulas and hidden-column exclusions", () => {
  const server = { amount: 35, percent: 62.5, formula: 19 };
  assert.deepEqual(fullFilteredGroupTotals([{ sums: { amount: 35, percent: 50, hidden: 90 } }, { sums: { amount: 80, percent: 75 } }], server, true), server);
  assert.equal(fullFilteredGroupTotals(undefined, { amount: 35 }, true), null);
});