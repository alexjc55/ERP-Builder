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

test("formula dependencies default to sum of row results, explicit modes override", () => {
  for (const mode of [undefined, "sum", "average", "formula"] as const) {
    const acc = new FormulaColumnTotal({ expression: "{ratio}*100", totalMode: "formula" });
    rows.forEach(row => acc.add({
      ...scope({ ...row, ratio: row.produced / row.planned }),
      entityFormulas: [{ key: "ratio", expression: "{produced}/{planned}", totalMode: mode }],
    }));
    assert.equal(acc.value(), mode === "formula" ? 19 : mode === "average" ? 55 : 110);
  }
});

test("page precedence, qualified references and materialized linked sources", () => {
  const acc = new FormulaColumnTotal({ expression: "{page:9.ratio}*100", totalMode: "formula" });
  rows.forEach(row => acc.add({
    ...scope({ planned: row.planned, produced: -1000, "linked:production": row.produced }),
    pageId: 9, pageValues: { produced: row.produced },
    pageFormulas: [{ key: "ratio", expression: "{linked:production}/{entity:1.planned}", totalMode: "formula" }],
  }));
  assert.equal(acc.value(), 19);
  const page = new FormulaColumnTotal({ expression, totalMode: "formula" });
  rows.forEach(row => page.add({ ...scope({ planned: row.planned, produced: -1000 }), pageId: 9, pageValues: { produced: row.produced } }));
  assert.equal(page.value(), 19);
});

test("production ratio uses rounded sum-of-products column totals, with page aliases", () => {
  for (const qualified of [false, true]) {
    const acc = new FormulaColumnTotal({
      expression: qualified ? "{entity:1.production_cost}*100/{page:9.units_total_price}" :
        "{production_cost}*100/{units_total_price}",
      totalMode: "formula", decimals: 2,
    });
    for (const row of [
      { quantity: 2, mnf_cost_unit: 3.24, unit_price: 10.24 },
      { quantity: 5, mnf_cost_unit: 4.11, unit_price: 20.11 },
    ]) acc.add({
      ...scope(row), pageId: 9, pageValues: { price: row.unit_price },
      entityFormulas: [{ key: "production_cost", expression: "{quantity}*{mnf_cost_unit}", decimals: 0 }],
      pageFormulas: [{ key: "units_total_price", expression: "{entity:1.quantity}*{page:9.price}", decimals: 0 }],
    });
    // round(6.48)+round(20.55)=27; round(20.48)+round(100.55)=121.
    // Not (2+5)*(3.24+4.11) / ((2+5)*(10.24+20.11)).
    assert.equal(acc.value(), 22.31);
  }
});

test("dependency suppression applies independently, including averages and nested formula totals", () => {
  for (const mode of ["sum", "average", "formula"] as const) {
    const acc = new FormulaColumnTotal({ expression: "{page:9.outer}", totalMode: "formula" });
    [10, 30].forEach((x, i) => acc.add({
      ...scope({ x }), pageId: 9,
      entityFormulas: [{ key: "inner", expression: "{x}", totalMode: mode }],
      pageFormulas: [{ key: "outer", expression: "{entity:1.inner}*2", totalMode: "formula" }],
      suppressedEntityKeys: new Set(i ? ["inner"] : []),
    }));
    assert.equal(acc.value(), mode === "average" ? 10 : 20);
  }
});

test("explicit formula-mode dependency cycles terminate", () => {
  const acc = new FormulaColumnTotal({ expression: "{a}", totalMode: "formula" });
  acc.add({
    ...scope({}),
    entityFormulas: [
      { key: "a", expression: "{b}", totalMode: "formula" },
      { key: "b", expression: "{a}", totalMode: "formula" },
    ],
  });
  assert.equal(acc.value(), 0);
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