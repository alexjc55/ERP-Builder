import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { isEntityActivityQuery, invalidateEntityActivity } from "./activityQueries";

test("activity refresh is entity-scoped across mirror page contexts", () => {
  assert.ok(isEntityActivityQuery(["/api/record-activity", { entityId: 7, recordId: 1, pageId: 2 }], 7));
  assert.ok(isEntityActivityQuery(["/api/activity-tasks", { entityId: 7, recordId: 1 }], 7));
  assert.ok(!isEntityActivityQuery(["/api/record-activity", { entityId: 8 }], 7));
  assert.ok(!isEntityActivityQuery(["/api/activity-tasks", { filter: "open" }], 7));
  assert.ok(!isEntityActivityQuery(["/api/activity-notifications"], 7));
});

test("successful mutation refreshes mounted history immediately and only marks closed history stale", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  const activeKey = ["/api/record-activity", { entityId: 7, recordId: 1 }];
  const closedKey = ["/api/record-activity", { entityId: 7, recordId: 2 }];
  const otherKey = ["/api/record-activity", { entityId: 8, recordId: 3 }];
  let reads = 0;
  client.setQueryData(activeKey, ["old"]);
  client.setQueryData(closedKey, ["old"]);
  client.setQueryData(otherKey, ["old"]);
  const observer = new QueryObserver(client, { queryKey: activeKey, queryFn: async () => { reads++; return ["new"]; } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(reads, 0);
    await invalidateEntityActivity(client, 7);
    assert.equal(reads, 1);
    assert.deepEqual(client.getQueryData(activeKey), ["new"]);
    assert.equal(client.getQueryState(closedKey)?.isInvalidated, true);
    assert.equal(client.getQueryState(otherKey)?.isInvalidated, false);
  } finally {
    unsubscribe();
    client.clear();
  }
});
