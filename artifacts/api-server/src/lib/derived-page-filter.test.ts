import assert from "node:assert/strict";
import test from "node:test";
import { entityRecordsTable } from "@workspace/db";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  derivedFilterDisplayValue,
  derivedPageValueMatches,
  linkedFilterValue,
  stableDerivedFilterValue,
  validateDerivedFilterCondition,
  validateDerivedOperandType,
} from "./derived-page-filter";
import { idArrayAny } from "./sql-id-array";

test("linked filter identity is stable when its display label changes", () => {
  const before = linkedFilterValue(42, "Acme");
  const after = linkedFilterValue(42, "Acme renamed");

  assert.equal(stableDerivedFilterValue(before), "__linked__:42");
  assert.equal(stableDerivedFilterValue(after), "__linked__:42");
  assert.equal(
    derivedPageValueMatches(after, { field: "customer", operator: "in", value: [before] }),
    true,
  );
});

test("duplicate linked labels remain distinct by linked record id", () => {
  const first = linkedFilterValue(10, "Duplicate");
  const second = linkedFilterValue(11, "Duplicate");

  assert.notEqual(stableDerivedFilterValue(first), stableDerivedFilterValue(second));
  assert.equal(
    derivedPageValueMatches(second, { field: "customer", operator: "in", value: [first] }),
    false,
  );
});

test("linked text matching searches decoded Unicode display labels", () => {
  const value = linkedFilterValue(15, "Договор ירושלים");
  assert.equal(derivedFilterDisplayValue(value), "Договор ירושלים");
  assert.equal(
    derivedPageValueMatches(value, { field: "customer", operator: "contains", value: "ירושלים" }),
    true,
  );
});

test("large id predicates compile to one array-bound parameter", () => {
  const ids = Array.from({ length: 10_000 }, (_, index) => index + 1);
  const query = new PgDialect().sqlToQuery(idArrayAny(entityRecordsTable.id, ids));
  assert.equal(query.params.length, 1);
  assert.deepEqual(query.params[0], ids);
  assert.equal((query.sql.match(/\$\d+/g) ?? []).length, 1);
});

test("derived matching preserves scalar, empty, numeric and half-open date behavior", () => {
  assert.equal(derivedPageValueMatches(12, { field: "amount", operator: "in", value: ["12"] }), true);
  assert.equal(derivedPageValueMatches(null, { field: "formula", operator: "in", value: ["__empty__"] }), true);
  assert.equal(derivedPageValueMatches(5, { field: "formula", operator: "between", value: [2, 6] }), true);
  assert.equal(
    derivedPageValueMatches("2026-02-01", {
      field: "formula",
      operator: "between",
      value: ["2026-01-01", "2026-02-01"],
    }),
    false,
  );
  assert.equal(derivedPageValueMatches(null, { operator: "gt", value: -1 }, "number"), false);
  assert.equal(derivedPageValueMatches(5, { operator: "between", value: [2] }, "number"), false);
  assert.equal(derivedPageValueMatches(5, { operator: "in", value: "5" }, "number"), false);
});

test("derived condition validation rejects malformed and type-incompatible operands", () => {
  assert.match(
    validateDerivedFilterCondition({ operator: "in", value: "5" }) ?? "",
    /non-empty array/,
  );
  assert.match(
    validateDerivedFilterCondition({ operator: "between", value: [1, { bad: true }] }) ?? "",
    /two scalar bounds/,
  );
  assert.match(
    validateDerivedFilterCondition({ operator: "contains", value: 12 }) ?? "",
    /text operand/,
  );
  assert.match(
    validateDerivedOperandType(
      { operator: "gt", value: "not-a-number" },
      [{ raw: 10, fieldType: "number" }],
    ) ?? "",
    /numeric operand/,
  );
  assert.match(
    validateDerivedOperandType(
      { operator: "in", value: ["Acme"] },
      [{ raw: "Acme", display: "Acme", linkedId: 42, fieldType: "text" }],
    ) ?? "",
    /linked record operand/,
  );
});