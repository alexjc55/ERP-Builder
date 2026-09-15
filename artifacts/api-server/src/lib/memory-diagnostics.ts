import type { RequestHandler } from "express";

/**
 * Memory diagnostics are deliberately opt-in. Reading process.memoryUsage is
 * inexpensive, but periodic logging should never be enabled accidentally on a
 * production process that has not been asked to provide this evidence.
 */
export const MEMORY_DIAGNOSTICS_ENV = "ERP_MEMORY_DIAGNOSTICS";
export const MEMORY_DIAGNOSTICS_INTERVAL_ENV = "ERP_MEMORY_DIAGNOSTICS_INTERVAL_SECONDS";
export const DEFAULT_MEMORY_DIAGNOSTICS_INTERVAL_MS = 60_000;
export const MIN_MEMORY_DIAGNOSTICS_INTERVAL_MS = 1_000;
export const MAX_MEMORY_DIAGNOSTICS_INTERVAL_MS = 60 * 60 * 1_000;

export interface MemoryUsageSnapshot {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

export interface MemoryDiagnosticsLogger {
  info: (payload: Record<string, unknown>, message: string) => void;
}

export interface MemoryDiagnosticsOptions {
  /**
   * Tests and an embedding process may explicitly choose whether to enable
   * diagnostics. Server startup leaves this unset and uses the env gate.
   */
  enabled?: boolean;
  intervalMs?: number;
  logger?: MemoryDiagnosticsLogger;
  getActiveRequests?: () => number;
}

export function isMemoryDiagnosticsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[MEMORY_DIAGNOSTICS_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * Keep operator input bounded. A too-frequent timer would create its own
 * logging overhead, while a very long timer is not useful during an incident.
 */
export function memoryDiagnosticsIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[MEMORY_DIAGNOSTICS_INTERVAL_ENV];
  if (raw == null || raw.trim() === "") return DEFAULT_MEMORY_DIAGNOSTICS_INTERVAL_MS;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_MEMORY_DIAGNOSTICS_INTERVAL_MS;
  }

  return Math.min(
    MAX_MEMORY_DIAGNOSTICS_INTERVAL_MS,
    Math.max(MIN_MEMORY_DIAGNOSTICS_INTERVAL_MS, Math.round(seconds * 1_000)),
  );
}

function boundIntervalMs(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return DEFAULT_MEMORY_DIAGNOSTICS_INTERVAL_MS;
  }
  return Math.min(
    MAX_MEMORY_DIAGNOSTICS_INTERVAL_MS,
    Math.max(MIN_MEMORY_DIAGNOSTICS_INTERVAL_MS, Math.round(intervalMs)),
  );
}

export function readMemoryUsage(): MemoryUsageSnapshot {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

function boundedActiveRequestCount(
  getActiveRequests: (() => number) | undefined,
): number | undefined {
  if (!getActiveRequests) return undefined;
  try {
    const count = getActiveRequests();
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : undefined;
  } catch {
    // Diagnostics must never take down the API if a caller's gauge fails.
    return undefined;
  }
}

/**
 * Start aggregate, low-overhead memory logging. The returned stop function is
 * useful to isolated tests and callers that own a server lifecycle. The timer
 * is unref'ed so diagnostics can never keep a process alive on their own.
 */
export function startMemoryDiagnostics(
  options: MemoryDiagnosticsOptions = {},
): (() => void) | undefined {
  const enabled = options.enabled ?? isMemoryDiagnosticsEnabled();
  if (!enabled) return undefined;

  const log = options.logger;
  if (!log) {
    throw new Error("Memory diagnostics requires the existing structured logger");
  }
  const intervalMs = boundIntervalMs(
    options.intervalMs ?? memoryDiagnosticsIntervalMs(),
  );
  const emit = () => {
    const activeRequests = boundedActiveRequestCount(options.getActiveRequests);
    log.info(
      {
        diagnostic: "api_memory",
        ...readMemoryUsage(),
        ...(activeRequests == null ? {} : { activeRequests }),
      },
      "API memory snapshot",
    );
  };

  // Capture a baseline as soon as the server opts in, then sample at a fixed
  // bounded interval. No request data, headers, URLs, or user identifiers are
  // included in this record.
  emit();
  const timer = setInterval(emit, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}

/**
 * Process-wide in-flight request gauge. It is installed only when diagnostics
 * are enabled, so the normal server path does not add response listeners.
 */
export class ActiveRequestTracker {
  private activeRequests = 0;

  readonly middleware: RequestHandler = (_req, res, next) => {
    this.activeRequests += 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    };

    res.once("finish", finish);
    res.once("close", finish);
    try {
      next();
    } catch (error) {
      finish();
      throw error;
    }
  };

  getActiveRequests(): number {
    return this.activeRequests;
  }
}