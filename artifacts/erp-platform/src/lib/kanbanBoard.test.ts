import assert from "node:assert/strict";
import test from "node:test";
import { fitBoardHeight, applyPendingMoves, buildLaneQuery, computeLanes, moveBetween, NULL_LANE } from "./kanbanBoard.ts";

const statuses = [
  { id: 2, sortOrder: 2 },
  { id: 1, sortOrder: 1 },
  { id: 3, sortOrder: 3, hideByDefault: true },
];

test("lanes sort, hide hidden-by-default, include null lane", () => {
  assert.deepEqual(computeLanes(statuses, {}), [NULL_LANE, "s:1", "s:2"]);
  assert.deepEqual(computeLanes(statuses, { showHiddenStatuses: true }), [NULL_LANE, "s:1", "s:2", "s:3"]);
});

test("statusIds selection intersects and drops null lane", () => {
  assert.deepEqual(computeLanes(statuses, { statusIds: [2, 9] }), ["s:2"]);
  assert.deepEqual(computeLanes(statuses, { excludeStatusIds: [1] }), [NULL_LANE, "s:2"]);
  assert.deepEqual(computeLanes(statuses, { statusIsNull: true }), [NULL_LANE]);
  assert.deepEqual(computeLanes(statuses, { statusIsNull: true, statusIds: [1] }), []);
});

test("lane query keeps base filters and scopes status", () => {
  const base = { search: "x", statusIds: [1, 2], filters: [{ f: 1 }] };
  const q = buildLaneQuery(base, "s:2", 3, 40);
  assert.deepEqual(q.statusIds, [2]);
  assert.equal(q.search, "x");
  assert.equal(q.page, 3);
  const n = buildLaneQuery({ search: "x" }, NULL_LANE, 1, 40);
  assert.equal(n.statusIsNull, true);
  assert.equal("statusIds" in n, false);
});

test("pending moves overlay stale refetches", () => {
  const rec = { id: 5, statusId: 2 };
  const pending = new Map([[5, { from: "s:1", to: "s:2", record: rec }]]);
  assert.deepEqual(applyPendingMoves("s:1", [{ id: 5, statusId: 1 }, { id: 6, statusId: 1 }], pending), [{ id: 6, statusId: 1 }]);
  assert.deepEqual(applyPendingMoves("s:2", [{ id: 7, statusId: 2 }], pending), [rec, { id: 7, statusId: 2 }]);
});

test("moveBetween returns source index", () => {
  const lanes = new Map([["s:1", [{ id: 1, statusId: 1 }, { id: 2, statusId: 1 }]], ["s:2", []]]);
  const r = moveBetween(lanes, 2, "s:1", "s:2", { id: 2, statusId: 2 });
  assert.equal(r.index, 1);
  assert.equal(r.lanes.get("s:1")!.length, 1);
  assert.equal(r.lanes.get("s:2")![0].statusId, 2);
  assert.equal(lanes.get("s:1")!.length, 2);
});

test("board height fits viewport", () => {
  assert.equal(fitBoardHeight(300, 900), 588);
  assert.equal(fitBoardHeight(-50, 900), 888);
  assert.equal(fitBoardHeight(850, 900), 160);
});
