import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFormulaGroupResults,
  formulaGroupResultWinners,
  secureFormulaGroupConfigs,
} from "./formula-group-result";

const row = (id: number, createdAt: string, entityValues: Record<string, unknown>, page: Record<string, unknown> = {}) => ({
  id, createdAt, entityValues, pageValues: new Map([[9, page]]),
});

test("groups a simple field and chooses oldest then lowest id", () => {
  const winners = formulaGroupResultWinners([
    row(3, "2024-01-01T00:00:00Z", { customer: "a" }),
    row(2, "2024-01-01T00:00:00Z", { customer: "a" }),
    row(1, "2024-02-01T00:00:00Z", { customer: "b" }),
  ], [{ key: "total", fields: [{ scope: "entity", fieldKey: "customer" }] }]);
  assert.deepEqual([...winners.get("total")!].sort(), [1, 2]);
});

test("supports compound entity/page tuples", () => {
  const winners = formulaGroupResultWinners([
    row(1, "2024-01-01", { customer: "a" }, { month: 1 }),
    row(2, "2024-01-02", { customer: "a" }, { month: 1 }),
    row(3, "2024-01-03", { customer: "a" }, { month: 2 }),
  ], [{ key: "total", fields: [
    { scope: "entity", fieldKey: "customer" },
    { scope: "page", pageId: 9, fieldKey: "month" },
  ] }]);
  assert.deepEqual([...winners.get("total")!].sort(), [1, 3]);
});

test("an empty tuple keeps each record unique", () => {
  const winners = formulaGroupResultWinners(
    [row(1, "2024-01-01", {}), row(2, "2024-01-01", {})],
    [{ key: "total", fields: [] }],
  );
  assert.deepEqual([...winners.get("total")!].sort(), [1, 2]);
});

test("fully empty configured keys keep each record unique", () => {
  const winners = formulaGroupResultWinners(
    [
      row(1, "2024-01-01", { customer: null }, { month: "" }),
      row(2, "2024-01-02", { customer: "  " }, {}),
    ],
    [{
      key: "total",
      fields: [
        { scope: "entity", fieldKey: "customer" },
        { scope: "page", pageId: 9, fieldKey: "month" },
      ],
    }],
  );
  assert.deepEqual([...winners.get("total")!].sort(), [1, 2]);
});

test("non-winning formula results become numeric zero", () => {
  const values = new Map([
    [1, { total: 42, untouched: "a" }],
    [2, { total: 42, untouched: "b" }],
  ]);
  assert.deepEqual(
    applyFormulaGroupResults(values, new Map([["total", new Set([1])]])),
    new Map([
      [1, { total: 42, untouched: "a" }],
      [2, { total: 0, untouched: "b" }],
    ]),
  );
});

test("winner is independent of request order", () => {
  const rows = [row(8, "2024-02-01", { x: 1 }), row(4, "2024-01-01", { x: 1 })];
  const config = [{ key: "f", fields: [{ scope: "entity" as const, fieldKey: "x" }] }];
  assert.deepEqual(formulaGroupResultWinners(rows, config), formulaGroupResultWinners([...rows].reverse(), config));
});

test("each formula has an independent grouping config", () => {
  const winners = formulaGroupResultWinners([
    row(1, "2024-01-01", { a: 1, b: 1 }),
    row(2, "2024-01-02", { a: 1, b: 2 }),
  ], [
    { key: "byA", fields: [{ scope: "entity", fieldKey: "a" }] },
    { key: "byB", fields: [{ scope: "entity", fieldKey: "b" }] },
  ]);
  assert.deepEqual([...winners.get("byA")!], [1]);
  assert.deepEqual([...winners.get("byB")!].sort(), [1, 2]);
});

test("secure configs support entity and page formulas against visible grouping fields", () => {
  const entityFormula = {
    fieldKey: "entity_total",
    fieldType: "function",
    formulaConfigJson: { groupResult: { enabled: true, fields: [{ scope: "entity", fieldKey: "customer" }] } },
  };
  const pageFormula = {
    fieldKey: "page_total",
    fieldType: "function",
    formulaConfigJson: { groupResult: { enabled: true, fields: [{ scope: "page", pageId: 9, fieldKey: "month" }] } },
  };
  assert.deepEqual(secureFormulaGroupConfigs({
    fields: [entityFormula, pageFormula],
    entityFields: [entityFormula, { fieldKey: "customer", fieldType: "text" }],
    pageFields: [pageFormula, { fieldKey: "month", fieldType: "number" }],
    pageId: 9,
  }), [
    { key: "entity_total", fields: [{ scope: "entity", fieldKey: "customer" }] },
    { key: "page_total", fields: [{ scope: "page", pageId: 9, fieldKey: "month" }] },
  ]);
});

test("secure configs reject hidden and foreign grouping fields", () => {
  const formula = (fields: unknown[]) => ({
    fieldKey: "total",
    fieldType: "function",
    formulaConfigJson: { groupResult: { enabled: true, fields } },
  });
  assert.deepEqual(secureFormulaGroupConfigs({
    fields: [formula([{ scope: "entity", fieldKey: "hidden" }])],
    entityFields: [{ fieldKey: "total", fieldType: "function" }],
  }), []);
  assert.deepEqual(secureFormulaGroupConfigs({
    fields: [formula([{ scope: "page", pageId: 10, fieldKey: "month" }])],
    entityFields: [],
    pageFields: [{ fieldKey: "month", fieldType: "number" }],
    pageId: 9,
  }), []);
});

test("full-set winners preserve empty keys and numeric zero before a displayed subset is applied", () => {
  const rows = [
    row(1, "2024-01-01", { customer: 0 }),
    row(2, "2024-01-02", { customer: 0 }),
    row(3, "2024-01-03", { customer: "" }),
    row(4, "2024-01-04", { customer: "" }),
  ];
  const winners = formulaGroupResultWinners(rows, [{
    key: "total",
    fields: [{ scope: "entity", fieldKey: "customer" }],
  }]);
  const displayed = applyFormulaGroupResults(new Map([
    [2, { total: 7 }],
    [3, { total: 8 }],
    [4, { total: 9 }],
  ]), winners);
  assert.equal(displayed.get(2)?.total, 0);
  assert.equal(displayed.get(3)?.total, 8);
  assert.equal(displayed.get(4)?.total, 9);
});

test("entity and page one-time formulas use independent winners on the same full set", () => {
  const rows = [
    row(1, "2024-01-01", { customer: "a" }, { month: 0 }),
    row(2, "2024-01-02", { customer: "a" }, { month: 0 }),
    row(3, "2024-01-03", { customer: "" }, { month: "" }),
    row(4, "2024-01-04", { customer: "" }, { month: "" }),
  ];
  const entityWinners = formulaGroupResultWinners(rows, [{
    key: "entity_total",
    fields: [{ scope: "entity", fieldKey: "customer" }],
  }]);
  const pageWinners = formulaGroupResultWinners(rows, [{
    key: "page_total",
    fields: [{ scope: "page", pageId: 9, fieldKey: "month" }],
  }]);
  const entityValues = applyFormulaGroupResults(new Map(rows.map((r) => [r.id, { entity_total: 5 }])), entityWinners);
  const pageValues = applyFormulaGroupResults(new Map(rows.map((r) => [r.id, { page_total: 6 }])), pageWinners);
  assert.deepEqual([...entityValues].map(([id, values]) => [id, values.entity_total]), [
    [1, 5], [2, 0], [3, 5], [4, 5],
  ]);
  assert.deepEqual([...pageValues].map(([id, values]) => [id, values.page_total]), [
    [1, 6], [2, 0], [3, 6], [4, 6],
  ]);
});