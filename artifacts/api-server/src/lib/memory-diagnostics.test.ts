import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  ActiveRequestTracker,
  DEFAULT_MEMORY_DIAGNOSTICS_INTERVAL_MS,
  MAX_MEMORY_DIAGNOSTICS_INTERVAL_MS,
  MIN_MEMORY_DIAGNOSTICS_INTERVAL_MS,
  isMemoryDiagnosticsEnabled,
  memoryDiagnosticsIntervalMs,
  readMemoryUsage,
  startMemoryDiagnostics,
  type MemoryDiagnosticsLogger,
} from "./memory-diagnostics";

test("memory usage snapshots contain only aggregate process counters", () => {
  const snapshot = readMemoryUsage();
  for (const key of ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers"] as const) {
    assert.equal(typeof snapshot[key], "number");
    assert.ok(Number.isFinite(snapshot[key]));
    assert.ok(snapshot[key] >= 0);
  }
});

test("diagnostics are disabled unless explicitly enabled", () => {
  const logs: unknown[] = [];
  const logger: MemoryDiagnosticsLogger = {
    info(payload) {
      logs.push(payload);
    },
  };

  const stop = startMemoryDiagnostics({ enabled: false, logger });
  assert.equal(stop, undefined);
  assert.equal(logs.length, 0);
});

test("the startup gate accepts explicit truthy values only", () => {
  assert.equal(isMemoryDiagnosticsEnabled({}), false);
  assert.equal(isMemoryDiagnosticsEnabled({ ERP_MEMORY_DIAGNOSTICS: "1" }), true);
  assert.equal(isMemoryDiagnosticsEnabled({ ERP_MEMORY_DIAGNOSTICS: "TRUE" }), true);
  assert.equal(isMemoryDiagnosticsEnabled({ ERP_MEMORY_DIAGNOSTICS: "off" }), false);
});

test("enabled diagnostics emit a bounded aggregate snapshot and can stop", () => {
  const logs: Array<{ payload: Record<string, unknown>; message: string }> = [];
  const logger: MemoryDiagnosticsLogger = {
    info(payload, message) {
      logs.push({ payload, message });
    },
  };

  const stop = startMemoryDiagnostics({
    enabled: true,
    intervalMs: MAX_MEMORY_DIAGNOSTICS_INTERVAL_MS,
    logger,
    getActiveRequests: () => 3.9,
  });
  assert.ok(stop);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.message, "API memory snapshot");
  assert.deepEqual(Object.keys(logs[0]?.payload ?? {}).sort(), [
    "activeRequests",
    "arrayBuffers",
    "diagnostic",
    "external",
    "heapTotal",
    "heapUsed",
    "rss",
  ]);
  assert.equal(logs[0]?.payload.activeRequests, 3);
  stop?.();
});

test("interval configuration is valid and bounded", () => {
  assert.equal(
    memoryDiagnosticsIntervalMs({}),
    DEFAULT_MEMORY_DIAGNOSTICS_INTERVAL_MS,
  );
  assert.equal(
    memoryDiagnosticsIntervalMs({ ERP_MEMORY_DIAGNOSTICS_INTERVAL_SECONDS: "0.1" }),
    MIN_MEMORY_DIAGNOSTICS_INTERVAL_MS,
  );
  assert.equal(
    memoryDiagnosticsIntervalMs({ ERP_MEMORY_DIAGNOSTICS_INTERVAL_SECONDS: "999999" }),
    MAX_MEMORY_DIAGNOSTICS_INTERVAL_MS,
  );
  assert.equal(
    memoryDiagnosticsIntervalMs({ ERP_MEMORY_DIAGNOSTICS_INTERVAL_SECONDS: "not-a-number" }),
    DEFAULT_MEMORY_DIAGNOSTICS_INTERVAL_MS,
  );
});

test("active request tracking is idempotent across finish and close", () => {
  const tracker = new ActiveRequestTracker();
  const response = new EventEmitter();
  const next = () => undefined;

  tracker.middleware({} as never, response as never, next);
  assert.equal(tracker.getActiveRequests(), 1);
  response.emit("finish");
  response.emit("close");
  assert.equal(tracker.getActiveRequests(), 0);
});

test("active request tracking handles multiple in-flight responses", () => {
  const tracker = new ActiveRequestTracker();
  const first = new EventEmitter();
  const second = new EventEmitter();

  tracker.middleware({} as never, first as never, () => undefined);
  tracker.middleware({} as never, second as never, () => undefined);
  assert.equal(tracker.getActiveRequests(), 2);
  first.emit("close");
  assert.equal(tracker.getActiveRequests(), 1);
  second.emit("finish");
  assert.equal(tracker.getActiveRequests(), 0);
});