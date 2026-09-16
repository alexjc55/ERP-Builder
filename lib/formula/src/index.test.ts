/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFormulaScope,
  DEFAULT_FORMULA_TIME_ZONE,
  DEFAULT_WORKING_DAYS,
  evaluateFormula,
  formatFormulaFieldResult,
  formatFormulaResult,
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

test("marks only numeric formula results as numeric for display formatting", () => {
  assert.equal(formatFormulaResult("1 / 4", {}, 2).numeric, true);
  assert.equal(formatFormulaResult('"25"', {}, 2).numeric, undefined);
  assert.equal(formatFormulaResult("true", {}, 2).numeric, undefined);
});

test("time-zone validity and formatter caches bound ICU constructors", { concurrency: false }, () => {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  let constructorCount = 0;
  const CountedDateTimeFormat = function (
    this: unknown,
    ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
  ) {
    constructorCount++;
    return new originalDateTimeFormat(...args);
  } as unknown as typeof Intl.DateTimeFormat;
  Object.defineProperty(CountedDateTimeFormat, "prototype", {
    value: originalDateTimeFormat.prototype,
  });
  Object.defineProperty(Intl, "DateTimeFormat", {
    value: CountedDateTimeFormat,
    writable: true,
    configurable: true,
  });

  try {
    const supportedValuesOf = (
      Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    assert.ok(supportedValuesOf, "the runtime must expose IANA timezone names");
    const validZones = supportedValuesOf("timeZone").slice(0, 129);
    assert.equal(validZones.length, 129);
    const fixedNow = new Date("2024-01-10T12:00:00Z");

    const validStart = constructorCount;
    for (const timeZone of validZones) {
      evaluateFormula("today()", {}, { timeZone, now: fixedNow });
    }
    assert.equal(
      constructorCount - validStart,
      validZones.length,
      "a new valid timezone should allocate one shared validation/day formatter",
    );

    const warmStart = constructorCount;
    const stableOptions = { timeZone: validZones[validZones.length - 1], now: fixedNow };
    for (let i = 0; i < 100; i++) {
      evaluateFormula("today()", {}, stableOptions);
      evaluateFormula("daysSince('2024-01-07')", {}, stableOptions);
      evaluateFormula("daysUntil('2024-01-14')", {}, stableOptions);
    }
    assert.equal(
      constructorCount - warmStart,
      0,
      "today/daysSince/daysUntil must reuse the cached timezone formatter",
    );

    const lastZoneStart = constructorCount;
    evaluateFormula("today()", {}, { timeZone: validZones[128], now: fixedNow });
    assert.equal(constructorCount - lastZoneStart, 0, "the newest valid timezone stays hot");

    const firstZoneStart = constructorCount;
    evaluateFormula("today()", {}, { timeZone: validZones[0], now: fixedNow });
    assert.equal(
      constructorCount - firstZoneStart,
      1,
      "the oldest valid timezone is evicted at the bounded cache limit",
    );

    const invalidZones = Array.from({ length: 129 }, (_, index) => `Invalid/Zone-${index}`);
    for (const timeZone of invalidZones) {
      assert.equal(
        evaluateFormula("today()", {}, { timeZone, now: fixedNow }),
        evaluateFormula("today()", {}, { timeZone: DEFAULT_FORMULA_TIME_ZONE, now: fixedNow }),
        "invalid timezone input must retain the default timezone fallback",
      );
    }
    const newestInvalidStart = constructorCount;
    evaluateFormula("today()", {}, { timeZone: invalidZones[128], now: fixedNow });
    assert.equal(constructorCount - newestInvalidStart, 0, "newest invalid entries stay cached");
    const oldestInvalidStart = constructorCount;
    evaluateFormula("today()", {}, { timeZone: invalidZones[0], now: fixedNow });
    assert.equal(
      constructorCount - oldestInvalidStart,
      1,
      "oldest invalid entries are evicted at the bounded cache limit",
    );
  } finally {
    Object.defineProperty(Intl, "DateTimeFormat", {
      value: originalDateTimeFormat,
      writable: true,
      configurable: true,
    });
  }
});

test("uses a server-materialized field value without re-evaluating protected sources", () => {
  assert.deepEqual(
    formatFormulaFieldResult(
      "days_in_paint",
      "{page:77.production_finish_date}",
      { days_in_paint: "2026-08-19" },
    ),
    { text: "2026-08-19", error: false },
  );
});

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

test("today and relative helpers preserve calendar dates across DST transitions", () => {
  const beforeTransition = {
    timeZone: "America/New_York",
    now: new Date("2024-03-10T04:30:00Z"),
  };
  const afterTransition = {
    timeZone: "America/New_York",
    now: new Date("2024-03-10T07:30:00Z"),
  };
  assert.equal(evaluateFormula("today()", {}, beforeTransition), "2024-03-09");
  assert.equal(evaluateFormula("today()", {}, afterTransition), "2024-03-10");
  assert.equal(
    evaluateFormula("daysSince('2024-03-09')", {}, afterTransition),
    1,
  );
  assert.equal(
    evaluateFormula("daysUntil('2024-03-11')", {}, afterTransition),
    1,
  );
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

test("treats qualified field references as opaque lookup keys", () => {
  assert.equal(
    evaluateFormula("{page:42.total} + {amount}", {
      "page:42.total": 8,
      amount: 2,
    }),
    10,
  );
  assert.equal(evaluateFormula("{ entity/order:price }", { "entity/order:price": 7 }), 7);
  assert.throws(() => evaluateFormula("{}", {}), /Пустая ссылка/);
});

test("supports scalar text helpers", () => {
  assert.equal(evaluateFormula("trim('  hello  ')", {}), "hello");
  assert.equal(evaluateFormula("replace('a-b-a', 'a', 'x')", {}), "x-b-x");
  assert.equal(evaluateFormula("replace('abc', '', 'x')", {}), "abc");
  assert.equal(evaluateFormula("contains('invoice-42', 'voice')", {}), true);
  assert.equal(evaluateFormula("startsWith('invoice-42', 'inv')", {}), true);
  assert.equal(evaluateFormula("endsWith('invoice-42', '42')", {}), true);
});

test("supports average over scalar arguments", () => {
  assert.equal(evaluateFormula("average(2, 4, 9)", {}), 5);
  assert.equal(evaluateFormula("AvErAgE({a}, {b})", { a: "2", b: 6 }), 4);
  assert.equal(evaluateFormula("average()", {}), null);
});