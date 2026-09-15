import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "express";
import {
  PRESENCE_TTL_MS,
  addStream,
  disposeCollaboration,
  globalPresenceSnapshot,
  presenceSnapshot,
  putPresence,
} from "./collaboration";

type FakeInterval = { callback: () => void; delay: number; cleared: boolean; unref(): void };

function fakeResponse(acceptWrites = true): Response & { writes: string[]; endCalls: number } {
  const response: {
    writableEnded: boolean;
    writes: string[];
    endCalls: number;
    write(frame: string): boolean;
    end(): void;
  } = {
    writableEnded: false,
    writes: [] as string[],
    endCalls: 0,
    write(frame: string): boolean {
      response.writes.push(frame);
      return acceptWrites;
    },
    end(): void {
      response.writableEnded = true;
      response.endCalls += 1;
    },
  };
  return response as unknown as Response & { writes: string[]; endCalls: number };
}

test("presence TTL cleanup and SSE replacement/slow-client cleanup are bounded", () => {
  const originalNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervals: FakeInterval[] = [];
  let now = 1_000_000;
  Date.now = () => now;
  globalThis.setInterval = ((callback: () => void, delay: number) => {
    const interval: FakeInterval = { callback, delay, cleared: false, unref() {} };
    intervals.push(interval);
    return interval as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle: ReturnType<typeof setInterval>) => {
    (handle as unknown as FakeInterval).cleared = true;
  }) as typeof clearInterval;

  try {
    const pageId = 9_876_501;
    const clientId = "lifecycle-client";
    const first = fakeResponse();
    const closeFirst = addStream(pageId, clientId, first, true, 501);
    const firstPing = intervals.find((interval) => interval.delay === 20_000)!;
    putPresence(pageId, clientId, { id: 501, name: "Lifecycle User" }, null);

    const replacement = fakeResponse();
    const closeReplacement = addStream(pageId, clientId, replacement, true, 501);
    assert.equal(first.endCalls, 1, "replacement must close the old SSE response");
    assert.equal(firstPing.cleared, true, "replacement must clear the old ping interval immediately");
    closeFirst();
    assert.equal(presenceSnapshot(pageId).length, 1, "stale close must not remove replacement presence");

    const pingCountBeforeSlowClient = intervals.filter((interval) => interval.delay === 20_000).length;
    const slow = fakeResponse(false);
    addStream(pageId + 1, "slow-client", slow, true, 502);
    assert.equal(slow.endCalls, 1, "a backpressured response must be closed for snapshot resync");
    assert.equal(
      intervals.filter((interval) => interval.delay === 20_000).length,
      pingCountBeforeSlowClient,
      "a closed slow stream must not retain a ping interval",
    );

    replacement.writes.length = 0;
    now += PRESENCE_TTL_MS;
    const cleanupTimer = intervals.find((interval) => interval.delay === 5_000 && !interval.cleared)!;
    cleanupTimer.callback();
    assert.equal(presenceSnapshot(pageId).length, 0, "idle cleaner must evict page presence");
    assert.equal(globalPresenceSnapshot().some((entry) => entry.userId === 501), false, "idle cleaner must evict global presence");
    assert.ok(
      replacement.writes.some((frame) => frame.includes("event:presence") && frame.includes('"presence":[]')),
      "expiry must notify active SSE viewers",
    );
    assert.equal(cleanupTimer.cleared, true, "empty presence registries must release the cleanup interval");

    closeReplacement();

    const disposable = fakeResponse();
    addStream(pageId + 2, "dispose-client", disposable, true, 503);
    putPresence(pageId + 2, "dispose-client", { id: 503, name: "Dispose User" }, null);
    disposeCollaboration();
    disposeCollaboration();
    assert.equal(disposable.endCalls, 1, "dispose must close each active SSE response once");
    assert.equal(presenceSnapshot(pageId + 2).length, 0);
    assert.equal(globalPresenceSnapshot().some((entry) => entry.userId === 503), false);
    assert.ok(
      intervals.filter((interval) => !interval.cleared).length === 0,
      "dispose must release presence and stream timers",
    );
  } finally {
    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});