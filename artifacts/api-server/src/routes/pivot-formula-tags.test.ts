import assert from "node:assert/strict";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { expandPivotTagAxes, pivotRound } from "./pivot-compute";

after(() => pool.end());

test("pivot rounding preserves large finite cells and totals through JSON serialization", () => {
  for (const value of [1e303, -1e303, Number.MAX_VALUE, -Number.MAX_VALUE]) {
    const rounded = pivotRound(value);
    assert.equal(rounded, value);
    const result = JSON.parse(JSON.stringify({
      cells: [{ value: rounded }],
      rowTotals: [{ value: rounded }],
      colTotals: [{ value: rounded }],
      grandTotal: rounded,
    }));
    assert.equal(result.cells[0].value, value);
    assert.equal(result.rowTotals[0].value, value);
    assert.equal(result.colTotals[0].value, value);
    assert.equal(result.grandTotal, value);
  }
  assert.equal(pivotRound(1.2345678), 1.234568);
  assert.equal(pivotRound(-1.2345678), -1.234568);
  for (const value of [Infinity, -Infinity, NaN]) {
    assert.throws(() => pivotRound(value), /numeric range/);
  }
});

test("tag axes expand unique assigned memberships with an untagged bucket", () => {
  const grouped = [{ rk: "a", ck: "a", v: 3 }, { rk: null, ck: "b", v: 5 }];
  const tags = new Map([["a", ["10", "10", "20"]]]);
  assert.deepEqual(expandPivotTagAxes(grouped, tags, true, false), [
    { rk: "10", ck: "a", v: 3 }, { rk: "20", ck: "a", v: 3 }, { rk: "", ck: "b", v: 5 },
  ]);
  const both = expandPivotTagAxes(grouped, tags, true, true);
  assert.equal(both.length, 5);
  assert.equal(both.reduce((sum, g) => sum + g.v, 0), 17);
  assert.deepEqual(both.at(-1), { rk: "", ck: "", v: 5 });
  assert.deepEqual(expandPivotTagAxes(grouped, tags, false, false), grouped);
});