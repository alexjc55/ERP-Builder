import assert from "node:assert/strict";
import test from "node:test";
import { webhookDisplayValues } from "./automation-webhook-values";

const field = (fieldKey: string, type: string, resolvedValue: unknown, displayValue = "", extra = {}) =>
  ({ fieldKey, type, resolvedValue, displayValue, pageId: null, contextPageId: null, ...extra });
const lookup = (key: string, ...children: unknown[]) => field(key, "lookup", children.map(child => ({ field: child })));

test("surface values expose names and labels, preserve numbers and booleans, and use file URLs", () => {
  const { displayValues } = webhookDisplayValues([
    field("client", "user", { id: 44, name: "Customer" }),
    field("status", "select", { id: "internal", label: "Ready" }, "Ready"),
    field("tags", "multiselect", [{ label: "A" }, { label: "B" }], "A, B"),
    field("sum", "function", 55.2, "55.20 USD"),
    field("zero", "number", 0, "0"),
    field("flag", "boolean", false, "Нет"),
    field("date", "date", "2026-01-15", "15.01.2026"),
    field("file", "file", { name: "PDF", url: "https://example.test/file" }, "PDF"),
    field("missingUser", "user", { id: 999, name: null }, "#999"),
    field("empty", "text", null, "—"),
    field("emptyList", "multiselect", [], "—"),
  ]);
  assert.deepEqual(displayValues, {
    client: "Customer", status: "Ready", tags: "A, B", sum: 55.2, zero: 0, flag: false,
    date: "15.01.2026", file: "https://example.test/file", missingUser: null, empty: null, emptyList: null,
  });
});
test("linked and chained values resolve to surface values, not IDs or invented totals", () => {
  const data = webhookDisplayValues([
    lookup("manager", lookup("nested", field("user", "user", { id: 9, name: "Manager" }))),
    lookup("amount", field("n", "number", 12, "12")),
    lookup("amounts", field("n", "number", 12, "12"), field("n", "number", 8, "8")),
    lookup("empty"),
    lookup("broken", field("file", "file", { url: "https://example.test" }, "", { error: "failed" })),
  ]).displayValues;
  assert.deepEqual(data, { manager: "Manager", amount: 12, amounts: "12, 8", empty: null, broken: null });
});
test("page-local and contextual values cannot overwrite the entity and local fields win in either order", () => {
  const base = field("name", "text", "Entity", "Entity");
  const local = field("name", "text", "Page", "Page", { pageId: 7, contextPageId: 7 });
  const context = field("name", "function", "Context", "Context", { contextPageId: 7 });
  for (const fields of [[base, local, context], [context, local, base]]) {
    assert.deepEqual(webhookDisplayValues(fields), { displayValues: { name: "Entity" }, pageDisplayValues: { "7": { name: "Page" } } });
  }
});
