import assert from "node:assert/strict";
import test from "node:test";
import { BoundedTtlCache, type TtlCacheScheduler } from "./bounded-ttl-cache";

class ControlledScheduler implements TtlCacheScheduler {
  nowMs = 0;
  private nextId = 0;
  readonly intervals = new Map<number, { callback: () => void; cleared: boolean }>();

  now(): number {
    return this.nowMs;
  }

  setInterval(callback: () => void, _intervalMs: number): ReturnType<typeof setInterval> {
    const id = ++this.nextId;
    this.intervals.set(id, { callback, cleared: false });
    return { unref() {} } as ReturnType<typeof setInterval>;
  }

  clearInterval(_handle: ReturnType<typeof setInterval>): void {
    for (const interval of this.intervals.values()) interval.cleared = true;
  }

  advanceTo(nowMs: number): void {
    this.nowMs = nowMs;
    for (const interval of this.intervals.values()) {
      if (!interval.cleared) interval.callback();
    }
  }
}

test("bounded TTL cache evicts expired entries without another key lookup", () => {
  const scheduler = new ControlledScheduler();
  const cache = new BoundedTtlCache<string, string>({ ttlMs: 100, maxEntries: 10, scheduler });
  cache.set("never-read-again", "value");

  scheduler.advanceTo(100);

  assert.equal(cache.size, 0);
  assert.ok([...scheduler.intervals.values()].every((interval) => interval.cleared));
});

test("bounded TTL cache enforces capacity without extending entry TTL", () => {
  const scheduler = new ControlledScheduler();
  const cache = new BoundedTtlCache<string, number>({ ttlMs: 100, maxEntries: 2, scheduler });
  cache.set("first", 1);
  cache.set("second", 2);
  cache.set("third", 3);

  assert.equal(cache.size, 2);
  assert.equal(cache.get("first"), undefined);
  assert.equal(cache.get("second"), 2);
  assert.equal(cache.get("third"), 3);
  scheduler.advanceTo(100);
  assert.equal(cache.size, 0);
});

test("an invalidation rejects a late asynchronous cache fill", () => {
  const scheduler = new ControlledScheduler();
  const cache = new BoundedTtlCache<string, string>({ ttlMs: 100, maxEntries: 2, scheduler });
  const staleFillGeneration = cache.generation;

  cache.invalidate("agent-key");
  cache.set("agent-key", "fresh-verdict");

  assert.equal(cache.setIfCurrent(staleFillGeneration, "agent-key", "stale-verdict"), false);
  assert.equal(cache.get("agent-key"), "fresh-verdict");
});