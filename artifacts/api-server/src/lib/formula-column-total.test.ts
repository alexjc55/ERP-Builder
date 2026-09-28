import assert from "node:assert/strict";
import test from "node:test";
import { FormulaColumnTotal } from "./formula-column-total";
import { normalizeFormulaFieldConfig, validateFormulaFieldConfig } from "./formula-field-config";
import { CreateEntityFieldBody, UpdateFieldBody, CreatePageFieldBody, UpdatePageFieldBody } from "@workspace/api-zod";
import { projectViewerFormulaValues } from "./formula-runtime";

const rows = [{ planned: 100, produced: 100 }, { planned: 900, produced: 90 }];
const expression = "{produced}/{planned}*100";
type Scope = Parameters<FormulaColumnTotal["add"]>[0];
const scope = (entityValues: Record<string, unknown>): Scope => ({ entityId: 1, entityValues, entityFormulas: [] });
const total = (mode: "sum" | "average" | "formula" | undefined, values = rows) => {
  const acc = new FormulaColumnTotal({ expression, totalMode: mode });
  values.forEach(row => acc.add(scope(row)));
  return acc.value();
};

test("110 sum (also legacy default), 55 average, 19 formula over source totals", () => {
  assert.equal(total(undefined), 110);
  assert.equal(total("sum"), 110);
  assert.equal(total("average"), 55);
  assert.equal(total("formula"), 19);
});

test("partitioning filtered rows produces independent group totals", () => {
  assert.equal(total("formula", rows.slice(0, 1)), 100);
  assert.equal(total("formula", rows.slice(1)), 10);
  // The caller passes the full filtered set, not the displayed page.
  assert.equal(total("formula", rows), 19);
});

test("average ignores null/text/boolean/errors but counts numeric zero", () => {
  const acc = new FormulaColumnTotal({ expression: "{x}", totalMode: "average" });
  [null, "", "text", true, 0, 20, Infinity].forEach(x => acc.add(scope({ x })));
  assert.equal(acc.value(), 10);
});

test("empty sets, zero divisors, and cycles remain finite", () => {
  for (const mode of ["sum", "average", "formula"] as const) {
    assert.equal(new FormulaColumnTotal({ expression, totalMode: mode }).value(), 0);
    const acc = new FormulaColumnTotal({ expression, totalMode: mode });
    acc.add(scope({ produced: 0, planned: 0 }));
    assert.equal(acc.value(), 0);
  }
  const cyclic = new FormulaColumnTotal({ expression: "{a}", totalMode: "formula" });
  cyclic.add({ ...scope({}), entityFormulas: [{ key: "a", expression: "{b}" }, { key: "b", expression: "{a}" }] });
  assert.equal(cyclic.value(), 0);
});

test("formula chains recompute over totals, never sum materialized intermediates", () => {
  const acc = new FormulaColumnTotal({ expression: "{ratio}*100", totalMode: "formula" });
  rows.forEach(row => acc.add({
    ...scope({ ...row, ratio: row.produced / row.planned }),
    entityFormulas: [{ key: "ratio", expression: "{produced}/{planned}" }],
  }));
  assert.equal(acc.value(), 19);
});

test("page precedence, qualified references and materialized linked sources", () => {
  const acc = new FormulaColumnTotal({ expression: "{page:9.ratio}*100", totalMode: "formula" });
  rows.forEach(row => acc.add({
    ...scope({ planned: row.planned, produced: -1000, "linked:production": row.produced }),
    pageId: 9, pageValues: { produced: row.produced },
    pageFormulas: [{ key: "ratio", expression: "{linked:production}/{entity:1.planned}" }],
  }));
  assert.equal(acc.value(), 19);
  const page = new FormulaColumnTotal({ expression, totalMode: "formula" });
  rows.forEach(row => page.add({ ...scope({ planned: row.planned, produced: -1000 }), pageId: 9, pageValues: { produced: row.produced } }));
  assert.equal(page.value(), 19);
});

test("once-per-group non-winners stay zero; aggregate inputs only use winners", () => {
  for (const mode of ["sum", "average", "formula"] as const) {
    const acc = new FormulaColumnTotal({ expression, totalMode: mode });
    acc.add(scope(rows[0]));
    acc.add(scope(rows[1]), true);
    assert.equal(acc.value(), mode === "average" ? 50 : 100);
  }
});

test("aggregate inputs cannot restore hidden fields stripped by the viewer boundary", () => {
  const acc = new FormulaColumnTotal({ expression: "{hidden}", totalMode: "formula" });
  const projected = projectViewerFormulaValues({ shown: 10, hidden: 999 }, [
    { fieldKey: "shown", fieldType: "number", formulaConfigJson: {} },
  ]);
  acc.add(scope(projected));
  assert.equal(acc.value(), 0);
});

test("legacy grouped sums omit wholly empty or suppressed values", () => {
  const acc = new FormulaColumnTotal({ expression: "{x}" });
  acc.add(scope({ x: null }));
  acc.add(scope({ x: 30 }), true);
  assert.equal(acc.hasGroupValue(), false);
  acc.add(scope({ x: 0 }));
  assert.equal(acc.hasGroupValue(), true);
  assert.equal(acc.value(), 0);
});

test("sum and average round row results first and preserve decimal configuration", () => {
  for (const mode of ["sum", "average"] as const) {
    const acc = new FormulaColumnTotal({ expression: "{x}", decimals: 2, totalMode: mode });
    acc.add(scope({ x: 0.334 })); acc.add(scope({ x: 0.334 }));
    assert.equal(acc.value(), mode === "sum" ? 0.66 : 0.33);
  }
});

test("entity and page create/update contracts preserve all modes and reject invalid ones", () => {
  for (const totalMode of ["sum", "average", "formula"] as const) {
    const formulaConfigJson = { expression, totalMode, displayAffix: "%", displayAffixPosition: "after" as const };
    const input = { fieldKey: "production", nameJson: { ru: "Производство" }, fieldType: "function" as const, formulaConfigJson };
    for (const schema of [CreateEntityFieldBody, UpdateFieldBody, CreatePageFieldBody, UpdatePageFieldBody]) {
      const parsed = schema.parse(input);
      assert.equal(parsed.formulaConfigJson?.totalMode, totalMode);
      assert.equal(normalizeFormulaFieldConfig(parsed.formulaConfigJson, "function")?.totalMode, totalMode);
    }
    assert.deepEqual(validateFormulaFieldConfig(formulaConfigJson), []);
  }
  assert.ok(validateFormulaFieldConfig({ totalMode: "invalid" }).length);
  assert.equal(UpdateFieldBody.safeParse({ formulaConfigJson: { totalMode: "invalid" } }).success, false);
  assert.equal(UpdatePageFieldBody.safeParse({ formulaConfigJson: { totalMode: "invalid" } }).success, false);
});