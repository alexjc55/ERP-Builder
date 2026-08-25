import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePivotMeasureDisplayAffix,
  type PivotDisplayAffixField,
} from "./pivot-display-affix";

const fieldMap = (
  fieldType: string,
  displayAffix?: string | null,
  displayAffixPosition?: "before" | "after" | null,
) =>
  new Map<string, PivotDisplayAffixField>([
    ["amount", { fieldType, formulaConfigJson: { displayAffix, displayAffixPosition } }],
  ]);

const sum = { agg: "sum", source: "entity", fieldKey: "amount" };

test("returns exact before/after metadata without changing measure data", () => {
  assert.deepEqual(
    resolvePivotMeasureDisplayAffix(sum, "revenue", fieldMap("number", "$", "before"), new Map()),
    { measureKey: "revenue", displayAffix: "$", displayAffixPosition: "before" },
  );
  assert.deepEqual(
    resolvePivotMeasureDisplayAffix(sum, null, fieldMap("number", "kg", "after"), new Map()),
    { measureKey: null, displayAffix: "kg", displayAffixPosition: "after" },
  );
});

test("supports function metadata and excludes blank, percent, and non-sum measures", () => {
  assert.deepEqual(
    resolvePivotMeasureDisplayAffix(sum, "m1", fieldMap("function", " units ", null), new Map()),
    { measureKey: "m1", displayAffix: "units", displayAffixPosition: "after" },
  );
  assert.equal(resolvePivotMeasureDisplayAffix(sum, "m1", fieldMap("number", "  "), new Map()), null);
  assert.equal(resolvePivotMeasureDisplayAffix(sum, "m1", fieldMap("percent", "%"), new Map()), null);
  assert.equal(
    resolvePivotMeasureDisplayAffix({ ...sum, agg: "count" }, "m1", fieldMap("number", "$"), new Map()),
    null,
  );
});

test("resolves page measures only from the scoped page-field map", () => {
  const pageSum = { ...sum, source: "page" };
  assert.equal(
    resolvePivotMeasureDisplayAffix(pageSum, "m1", fieldMap("number", "wrong"), new Map()),
    null,
  );
  assert.deepEqual(
    resolvePivotMeasureDisplayAffix(pageSum, "m1", new Map(), fieldMap("number", "₪", "before")),
    { measureKey: "m1", displayAffix: "₪", displayAffixPosition: "before" },
  );
});