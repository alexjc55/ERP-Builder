import assert from "node:assert/strict";
import { test } from "node:test";
import { isWidgetSumField } from "./widgetMetricFields.ts";

test("sum picker supports entity/page formulas but excludes inactive and nonnumeric stored fields", () => {
  assert.equal(isWidgetSumField({ fieldType: "number" }), true);
  assert.equal(isWidgetSumField({ fieldType: "function", formulaConfigJson: { expression: "{price} * {qty}" } }), true);
  assert.equal(isWidgetSumField({ fieldType: "function", formulaConfigJson: {} }), false);
  assert.equal(isWidgetSumField({ fieldType: "number", isActive: false }), false);
  for (const fieldType of ["text", "date", "boolean", "file"]) assert.equal(isWidgetSumField({ fieldType }), false);
});