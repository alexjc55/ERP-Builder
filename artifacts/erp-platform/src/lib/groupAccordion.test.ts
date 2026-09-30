import { test } from "node:test";
import assert from "node:assert/strict";
import { groupedQueryOptions, isGroupExpanded, toggleGroupException } from "./groupAccordion.ts";

for (const initial of [false, true]) {
  test(`independent groups, null group and global actions from default ${initial}`, () => {
    let defaultExpanded = initial;
    let exceptions = new Set<string>();
    const query = { pageId: 9, page: 3, pageSize: 50, filters: [{ fieldKey: "title", operator: "eq", value: "allowed" }], ...groupedQueryOptions(true) };
    const queryKey = JSON.stringify(query);
    const totals = { amount: 150, percent: 62.5 };
    const open = (key: string) => isGroupExpanded(defaultExpanded, exceptions, key);
    exceptions = toggleGroupException(exceptions, "A");
    assert.equal(open("A"), !initial);
    assert.equal(open("B"), initial);
    exceptions = toggleGroupException(exceptions, "B");
    assert.equal(open("A"), !initial);
    assert.equal(open("B"), !initial);
    exceptions = toggleGroupException(exceptions, "\u0000__null__");
    assert.equal(open("\u0000__null__"), !initial);
    exceptions = toggleGroupException(exceptions, "A");
    assert.equal(open("A"), initial);
    defaultExpanded = true; exceptions = new Set();
    assert.equal(open("A"), true); assert.equal(open("B"), true);
    defaultExpanded = false; exceptions = new Set();
    assert.equal(open("A"), false); assert.equal(open("B"), false);
    assert.equal(JSON.stringify(query), queryKey);
    assert.equal(query.page, 3);
    assert.deepEqual(totals, { amount: 150, percent: 62.5 });
    assert.deepEqual(groupedQueryOptions(false), {});
    assert.equal("groupValue" in query, false);
  });
}