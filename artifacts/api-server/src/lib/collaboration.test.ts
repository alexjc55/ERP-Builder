import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Response } from "express";
import {
  PRESENCE_TTL_MS,
  STREAM_AUTHORIZATION_TIMEOUT_MS,
  addStream,
  broadcast,
  disposeCollaboration,
  globalPresenceSnapshot,
  presenceSnapshot,
  putPresence,
} from "./collaboration";

type FakeInterval = { callback: () => void; delay: number; cleared: boolean; unref(): void };
const authorized = async () => ({ canSeeEditing: true });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

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

test("presence TTL cleanup and SSE replacement/slow-client cleanup are bounded", async () => {
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
    const closeFirst = addStream(pageId, clientId, first, true, 501, authorized);
    await settle();
    const firstPing = intervals.find((interval) => interval.delay === 20_000)!;
    putPresence(pageId, clientId, { id: 501, name: "Lifecycle User" }, null);

    const replacement = fakeResponse();
    const closeReplacement = addStream(pageId, clientId, replacement, true, 501, authorized);
    await settle();
    assert.equal(first.endCalls, 1, "replacement must close the old SSE response");
    assert.equal(firstPing.cleared, true, "replacement must clear the old ping interval immediately");
    closeFirst();
    assert.equal(presenceSnapshot(pageId).length, 1, "stale close must not remove replacement presence");

    const pingCountBeforeSlowClient = intervals.filter((interval) => interval.delay === 20_000 && !interval.cleared).length;
    const slow = fakeResponse(false);
    addStream(pageId + 1, "slow-client", slow, true, 502, authorized);
    await settle();
    assert.equal(slow.endCalls, 1, "a backpressured response must be closed for snapshot resync");
    assert.equal(
      intervals.filter((interval) => interval.delay === 20_000 && !interval.cleared).length,
      pingCountBeforeSlowClient,
      "a closed slow stream must not retain a ping interval",
    );

    replacement.writes.length = 0;
    now += PRESENCE_TTL_MS;
    const cleanupTimer = intervals.find((interval) => interval.delay === 5_000 && !interval.cleared)!;
    cleanupTimer.callback();
    await settle();
    assert.equal(presenceSnapshot(pageId).length, 0, "idle cleaner must evict page presence");
    assert.equal(globalPresenceSnapshot().some((entry) => entry.userId === 501), false, "idle cleaner must evict global presence");
    assert.ok(
      replacement.writes.some((frame) => frame.includes("event:presence") && frame.includes('"presence":[]')),
      "expiry must notify active SSE viewers",
    );
    assert.equal(cleanupTimer.cleared, true, "empty presence registries must release the cleanup interval");

    closeReplacement();

    const disposable = fakeResponse();
    addStream(pageId + 2, "dispose-client", disposable, true, 503, authorized);
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

test("open stream rechecks access before changes and presence; revoked participant is removed", async () => {
  const pageId = 9_876_510;
  let allowed = true;
  let checks = 0;
  const alice = fakeResponse();
  const bob = fakeResponse();
  try {
    addStream(pageId, "alice", alice, true, 601, async () => {
      checks += 1;
      return allowed ? { canSeeEditing: true } : null;
    });
    addStream(pageId, "bob", bob, true, 602, authorized);
    putPresence(pageId, "alice", { id: 601, name: "Alice" }, null);
    putPresence(pageId, "bob", { id: 602, name: "Bob" }, null);
    await settle();
    assert.ok(alice.writes.some(frame => frame.includes('"name":"Bob"')));
    const baseline = alice.writes.length;
    const baselineChecks = checks;
    allowed = false; // No close/disconnect before revocation.
    broadcast(pageId, "page_config_changed", { statusIds: [12345], privateMetadata: "secret" });
    putPresence(pageId, "bob", { id: 602, name: "Secret after revocation" },
      { entityId: 90, recordId: 42, fieldKey: "secret", source: "entity" });
    await settle();
    assert.ok(checks > baselineChecks);
    assert.deepEqual(alice.writes.slice(baseline), [
      'event:access_denied\ndata:{"error":"Collaboration access unavailable"}\n\n',
    ]);
    assert.equal(alice.endCalls, 1);
    assert.equal(presenceSnapshot(pageId).some(entry => entry.userId === 601), false);
    assert.equal(globalPresenceSnapshot().some(entry => entry.userId === 601), false);
    assert.ok(bob.writes.some(frame => frame === "event:page_config_changed\ndata:{}\n\n"));
    assert.equal(bob.writableEnded, false);
  } finally {
    disposeCollaboration();
  }
});

test("presence coordinates use fresh field/row visibility and failed checks fail closed", async () => {
  const pageId = 9_876_511;
  let canSeeEditing = true;
  let fail = false;
  const response = fakeResponse();
  try {
    addStream(pageId, "viewer", response, true, 603, async () => {
      if (fail) throw new Error("Authorization unavailable");
      return { canSeeEditing };
    });
    await settle();
    canSeeEditing = false;
    putPresence(pageId, "editor", { id: 604, name: "Editor" },
      { entityId: 90, recordId: 43, fieldKey: "hidden", source: "entity" });
    await settle();
    assert.ok(response.writes.at(-1)?.includes('"editing":null'));
    assert.ok(!response.writes.at(-1)?.includes('"recordId"'));
    fail = true;
    const baseline = response.writes.length;
    putPresence(pageId, "editor", { id: 604, name: "New secret" }, null);
    await settle();
    assert.equal(response.writes.length, baseline + 1);
    assert.ok(response.writes.at(-1)?.includes("event:access_denied"));
    assert.equal(response.endCalls, 1);
  } finally {
    disposeCollaboration();
  }
});

test("in-flight checks cannot write after stream replacement; pending frames are bounded", async () => {
  const pageId = 9_876_512;
  let resolve!: (value: { canSeeEditing: boolean }) => void;
  const pending = new Promise<{ canSeeEditing: boolean }>(done => { resolve = done; });
  const old = fakeResponse();
  const replacement = fakeResponse();
  try {
    addStream(pageId, "tab", old, true, 605, () => pending);
    addStream(pageId, "tab", replacement, true, 605, authorized);
    resolve({ canSeeEditing: true });
    await settle();
    assert.equal(old.writes.length, 0);
    assert.equal(old.endCalls, 1);
    assert.ok(replacement.writes.some(frame => frame.includes("event:snapshot")));
    const blocked = fakeResponse();
    addStream(pageId + 1, "blocked", blocked, true, 606, () => new Promise(() => {}));
    for (let i = 0; i < 40; i++) broadcast(pageId + 1, `event-${i}`, {});
    assert.equal(blocked.endCalls, 1);
    assert.equal(blocked.writes.length, 0);
  } finally {
    disposeCollaboration();
  }
});

test("distinct record invalidations coalesce into a full opaque refresh without losing snapshot coverage", async () => {
  const pageId = 9_876_513;
  let release!: (value: { canSeeEditing: boolean }) => void;
  const gate = new Promise<{ canSeeEditing: boolean }>(resolve => { release = resolve; });
  const response = fakeResponse();
  let checks = 0;
  try {
    addStream(pageId, "viewer", response, true, 607, () => ++checks === 1 ? gate : authorized());
    broadcast(pageId, "record_changed", { recordId: 1, version: 2 });
    broadcast(pageId, "record_changed", { recordId: 2, version: 3 });
    broadcast(pageId, "page_changed", { recordId: 3 });
    broadcast(pageId, "delete", { recordId: 4 });
    release({ canSeeEditing: true });
    await settle();
    assert.equal(response.writes.length, 2);
    assert.ok(response.writes[0].startsWith("event:snapshot"));
    assert.equal(response.writes[1], "event:table_changed\ndata:{}\n\n");
    assert.equal(checks, 2, "coalesced refresh still gets a separate fresh authorization");
  } finally {
    disposeCollaboration();
  }
});

test("hung authorization times out fail closed; late verdict cannot revive the stream", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timeout!: () => void;
  let cleared = false;
  let release!: (value: { canSeeEditing: boolean }) => void;
  const gate = new Promise<{ canSeeEditing: boolean }>(resolve => { release = resolve; });
  const response = fakeResponse();
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    assert.equal(delay, STREAM_AUTHORIZATION_TIMEOUT_MS);
    timeout = callback;
    return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => { cleared = true; }) as typeof clearTimeout;
  try {
    addStream(9_876_514, "hung", response, true, 608, () => gate);
    timeout();
    await settle();
    assert.equal(response.endCalls, 1);
    assert.equal(cleared, true);
    assert.deepEqual(response.writes, ['event:access_denied\ndata:{"error":"Collaboration access unavailable"}\n\n']);
    release({ canSeeEditing: true });
    await settle();
    assert.equal(response.writes.length, 1);
  } finally {
    disposeCollaboration();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("idle ping also checks authorization and releases the stream timer on denial", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let ping!: () => void;
  let cleared = false;
  let allowed = true;
  const response = fakeResponse();
  globalThis.setInterval = ((callback: () => void, delay: number) => {
    assert.equal(delay, 20_000);
    ping = callback;
    return { unref() {} } as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  globalThis.clearInterval = (() => { cleared = true; }) as typeof clearInterval;
  try {
    addStream(9_876_515, "idle", response, true, 609, async () => allowed ? { canSeeEditing: true } : null);
    await settle();
    allowed = false;
    ping();
    await settle();
    assert.ok(response.writes.at(-1)?.includes("event:access_denied"));
    assert.equal(response.writes.some(frame => frame === ":ping\n\n"), false);
    assert.equal(response.endCalls, 1);
    assert.equal(cleared, true);
  } finally {
    disposeCollaboration();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("route frame authorization uses a new request without original permission/role/mirror caches", () => {
  const source = readFileSync(new URL("../routes/collaboration.ts", import.meta.url), "utf8");
  const callback = source.slice(source.indexOf("const close = addStream"), source.indexOf('req.on("close"'));
  assert.match(callback, /const fresh = \{\s*headers: req\.headers, method: req\.method, path: req\.path,\s*\} as Request/);
  assert.match(callback, /requireAuth\(fresh,/);
  assert.match(callback, /eq\(usersTable\.id, fresh\.user\.userId\)/);
  assert.match(callback, /if \(!account\?\.isActive\) return null/);
  assert.match(callback, /visibilityProfile\(fresh, deniedResponse, pageId\)/);
  assert.doesNotMatch(callback, /visibilityProfile\(req,|req\.permissions|req\._roleIds|req\._pageMirror/);
});