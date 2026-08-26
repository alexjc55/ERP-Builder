import assert from "node:assert/strict";
import test from "node:test";
import { applyFormulaGroupResults, formulaGroupResultWinners } from "./formula-group-result";

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