import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecordQuery } from "@workspace/api-client-react";
import { groupUniverseKey, isAccordionSelectionChange } from "./groupQueryScope.ts";

const scope = (query: RecordQuery, permission = "allowed", page = "mirror") => ({
  scope: page,
  permission,
  query: JSON.stringify(query),
  universe: groupUniverseKey(query),
  selection: JSON.stringify([query.groupValue, query.withRowGroups]),
});

test("opening, switching, closing and expanding all keep the filtered group headers", () => {
  const collapsed: RecordQuery = { grouped: true, page: 1, pageSize: 50, statusIds: [9] };
  const opened: RecordQuery = { ...collapsed, groupValue: { value: "A" } };
  const switched: RecordQuery = { ...collapsed, groupValue: { value: "B" } };
  const expandedAll: RecordQuery = { ...collapsed, withRowGroups: true };
  assert.equal(isAccordionSelectionChange(scope(collapsed), scope(opened)), true);
  assert.equal(isAccordionSelectionChange(scope(opened), scope(switched)), true);
  assert.equal(isAccordionSelectionChange(scope(switched), scope(collapsed)), true);
  assert.equal(isAccordionSelectionChange(scope(collapsed), scope(expandedAll)), true);
  assert.equal(isAccordionSelectionChange(scope({ ...opened, page: 4 }), scope(switched)), true);
});

test("filters, pagination alone, permissions, and mirror scope invalidate old headers", () => {
  const collapsed: RecordQuery = { grouped: true, page: 1, pageSize: 50 };
  const open: RecordQuery = { ...collapsed, groupValue: { value: null } };
  assert.equal(isAccordionSelectionChange(scope(collapsed), scope({ ...collapsed, page: 2 })), false);
  assert.equal(isAccordionSelectionChange(scope(collapsed), scope({ ...open, statusIds: [7] })), false);
  assert.equal(isAccordionSelectionChange(scope(collapsed), scope(open, "restricted")), false);
  assert.equal(isAccordionSelectionChange(scope(collapsed), scope(open, "allowed", "other-page")), false);
});