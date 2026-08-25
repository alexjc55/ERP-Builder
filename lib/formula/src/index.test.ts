/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFormulaScope,
  DEFAULT_WORKING_DAYS,
  evaluateFormula,
  type FormulaEvaluationOptions,
  type FormulaFieldDef,
} from "./index";

const workingDaysBetween = (
  start: unknown,
  end: unknown,
  options?: FormulaEvaluationOptions,
) =>
  evaluateFormula(
    "workingDaysBetween({start}, {end})",
    { start, end },
    options,
  );

test("uses the default Sunday-through-Thursday workweek", () => {
  assert.deepEqual(DEFAULT_WORKING_DAYS, [7, 1, 2, 3, 4]);
  assert.equal(workingDaysBetween("2024-01-07", "2024-01-11"), 4);
  assert.equal(workingDaysBetween("2024-01-04", "2024-01-07"), 1);
  assert.equal(workingDaysBetween("2024-01-05", "2024-01-06"), 0);
});

test("supports custom workweeks and excludes start while including end", () => {
  const options = { workingDays: [1, 2, 3, 4, 5] };
  assert.equal(workingDaysBetween("2024-01-05", "2024-01-08", options), 1);
  assert.equal(workingDaysBetween("2024-01-04", "2024-01-09", options), 3);
  assert.equal(workingDaysBetween("2024-01-08", "2024-01-08", options), 0);
});

test("reverse spans are the exact negative of forward spans", () => {
  const options = { workingDays: [1, 3, 5] };
  const forward = workingDaysBetween("2024-01-02", "2024-02-12", options);
  const reverse = workingDaysBetween("2024-02-12", "2024-01-02", options);
  assert.equal(reverse, -(forward as number));
});

test("invalid working-day options safely use the default", () => {
  const expected = workingDaysBetween("2024-01-04", "2024-01-07");
  const invalidOptions = [
    { workingDays: [] },
    { workingDays: [0, 1, 2] },
    { workingDays: [1, 1, 2] },
    { workingDays: ["1", 2] },
  ];
  for (const options of invalidOptions) {
    assert.equal(
      workingDaysBetween(
        "2024-01-04",
        "2024-01-07",
        options as unknown as FormulaEvaluationOptions,
      ),
      expected,
    );
  }
});

test("returns null for empty and invalid calendar values", () => {
  assert.equal(workingDaysBetween("", "2024-01-08"), null);
  assert.equal(workingDaysBetween(null, "2024-01-08"), null);
  assert.equal(workingDaysBetween("2024-02-30", "2024-03-01"), null);
  assert.equal(workingDaysBetween("01/07/2024", "2024-01-08"), null);
});

test("accepts strict ISO datetimes using their leading calendar dates", () => {
  assert.equal(
    workingDaysBetween(
      "2024-01-04T23:59:59.999+02:00",
      "2024-01-07T00:00:00Z",
    ),
    1,
  );
});

test("daysBetween retains calendar-day and datetime behavior", () => {
  assert.equal(
    evaluateFormula(
      "daysBetween({start}, {end})",
      {
        start: "2024-03-29T23:30:00-07:00",
        end: "2024-04-01T00:30:00+03:00",
      },
    ),
    3,
  );
  assert.equal(evaluateFormula("daysBetween('2024-01-02', '2024-01-02')", {}), 0);
});

test("daysSince and daysUntil retain their existing calendar semantics", () => {
  const options = {
    timeZone: "UTC",
    now: new Date("2024-01-10T12:00:00Z"),
  };
  assert.equal(evaluateFormula("daysSince('2024-01-07')", {}, options), 3);
  assert.equal(evaluateFormula("daysUntil('2024-01-14')", {}, options), 4);
});

test("working days flow through lazy formula scopes used by related and page-local formulas", () => {
  const fields: FormulaFieldDef[] = [
    {
      key: "page_working_span",
      expression: "workingDaysBetween({related_start}, {related_end})",
    },
  ];
  const options = { workingDays: [1, 2, 3, 4, 5] };
  const scope = buildFormulaScope(
    {
      related_start: "2024-01-05",
      related_end: "2024-01-08",
    },
    fields,
    options,
  );
  assert.equal(evaluateFormula("{page_working_span}", scope, options), 1);
});

test("function parsing remains case-insensitive", () => {
  assert.equal(
    evaluateFormula(
      "WoRkInGdAySbEtWeEn('2024-01-07', '2024-01-08')",
      {},
    ),
    1,
  );
});