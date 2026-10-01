import assert from "node:assert/strict";
import { test } from "node:test";
import { isMetricSumField, sumFormulaMetricValues } from "./dashboard-formula-metric";
import { buildFormulaScope, FormulaComputationError } from "@workspace/formula";
import { buildQualifiedFormulaScope } from "./formula-runtime";

test("metric metadata accepts configured dynamically-typed formulas, not text fields or empty definitions", () => {
  assert.equal(isMetricSumField({ fieldType: "number" }), true);
  assert.equal(isMetricSumField({ fieldType: "function", formulaConfigJson: { expression: "{price} * {qty}" } }), true);
  assert.equal(isMetricSumField({ fieldType: "function", formulaConfigJson: {} }), false);
  assert.equal(isMetricSumField({ fieldType: "date" }), false);
  assert.equal(isMetricSumField({ fieldType: "text" }), false);
});

test("formula sum rounds each row then aggregate, with null/empty ignored and FP noise cleaned", () => {
  assert.equal(sumFormulaMetricValues([1.235, 1.235], "amount", 2), 2.48);
  assert.equal(sumFormulaMetricValues([71.63 * 110, 0.1 + 0.2, null, ""], "amount", null), 7879.6);
  assert.equal(sumFormulaMetricValues([], "amount", 2), 0);
});

test("text, dates, booleans and nonfinite results fail explicitly instead of becoming zero", () => {
  for (const value of ["100", "2026-01-01", true, Infinity, NaN]) {
    assert.throws(() => sumFormulaMetricValues([10, value], "amount", null), /Cannot sum formula "amount"/);
  }
});

test("strict shared scope distinguishes malformed/cyclic formulas from legitimate null and ignores stale storage", () => {
  const formulas = [
    { key: "amount", expression: "{qty}*2" }, { key: "bad", expression: "1+" },
    { key: "cycle", expression: "{cycle}" }, { key: "empty", expression: "{missing}" },
  ];
  const scope = buildFormulaScope({ qty: 3, amount: 9999 }, formulas, { throwOnError: true, ignoreStoredFormulaValues: true });
  assert.equal(scope.amount, 6);
  assert.equal(scope.empty, null);
  assert.throws(() => scope.bad, FormulaComputationError);
  assert.throws(() => scope.cycle, FormulaComputationError);
  // Existing display readers keep their established error-to-null behavior.
  const legacy = buildFormulaScope({}, formulas);
  assert.equal(legacy.bad, null);
  assert.equal(legacy.cycle, null);
});

test("aggregate strict arithmetic failures cannot turn into zero while legitimate empty results can", () => {
  for (const expression of ["1 / 0", "1 % 0"]) {
    const scope = buildFormulaScope({}, [{ key: "amount", expression }], { throwOnError: true });
    assert.throws(() => sumFormulaMetricValues([scope.amount], "amount", 2), FormulaComputationError);
  }
  const empty = buildFormulaScope({}, [{ key: "amount", expression: "{missing}" }], { throwOnError: true });
  assert.equal(sumFormulaMetricValues([empty.amount, ""], "amount", 2), 0);
});

test("strict recomputation preserves genuine page scalar shadows inside entity/page formula dependencies", () => {
  for (const strict of [false, true]) {
    const scope = buildQualifiedFormulaScope({
      entityId: 1, pageId: 2,
      entityValues: { qty: 3, ...(strict ? { amount: 9999, entity_copy: 8888 } : {}) },
      pageValues: { amount: 100, ...(strict ? { page_copy: 7777 } : {}) },
      entityFormulas: [{ key: "amount", expression: "{qty}*2" }, { key: "entity_copy", expression: "{amount}+1" }],
      pageFormulas: [{ key: "page_copy", expression: "{amount}+1" }],
      formulaOptions: { throwOnError: strict, ignoreStoredFormulaValues: strict },
    });
    assert.equal(scope["entity:1.amount"], 6);
    assert.equal(scope.amount, 100);
    assert.equal(scope["entity:1.entity_copy"], 101);
    assert.equal(scope["page:2.page_copy"], 101);
  }
});