import assert from "node:assert/strict";
import test from "node:test";
import { sameAggregateTopology } from "./aggregateSnapshot.ts";

test("unchanged groups can publish authoritative aggregates before row projections", () => {
  assert.equal(sameAggregateTopology([{ key: "a", count: 1 }], [{ key: "a", count: 1 }], { 1: "a" }, { 1: "a" }), true);
  assert.equal(sameAggregateTopology(null, null, {}, {}), true);
  assert.equal(sameAggregateTopology([{ key: null, count: 1 }], [{ key: null, count: 1 }], { 1: null }, { 1: null }), true);
});

test("moving rows or changing group structure must wait for the complete replacement", () => {
  const groups = [{ key: "a", count: 1 }, { key: "b", count: 1 }];
  assert.equal(sameAggregateTopology(groups, groups, { 1: "a", 2: "b" }, { 1: "b", 2: "a" }), false);
  assert.equal(sameAggregateTopology(groups, [...groups].reverse(), {}, {}), false);
  assert.equal(sameAggregateTopology(groups, [{ key: "a", count: 2 }], {}, {}), false);
  assert.equal(sameAggregateTopology(groups, null, {}, {}), false);
  assert.equal(sameAggregateTopology(groups, groups, { 1: "a" }, { 2: "a" }), false);
});