import type { Server } from "node:http";

export type ShutdownSignal = "SIGTERM" | "SIGINT";

export interface ShutdownSignalSource {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  removeListener?(signal: ShutdownSignal, listener: () => void): unknown;
}

export interface ClosableHttpServer {
  close(callback?: (error?: Error) => void): void;
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
}

export interface ShutdownLogger {
  error(payload: Record<string, unknown>, message: string): void;
}

export interface GracefulShutdownOptions {
  server: ClosableHttpServer | Server;
  stopMemoryDiagnostics?: () => void;
  disposeCollaboration?: () => void;
  disposeBackgroundWork?: () => void;
  closeTimeoutMs?: number;
  signalSource?: ShutdownSignalSource;
  logger?: ShutdownLogger;
  exit?: (code: number) => void;
}

export interface GracefulShutdownOwner {
  install(): void;
  shutdown(signal?: ShutdownSignal): Promise<void>;
}

const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;
const MAX_CLOSE_TIMEOUT_MS = 60_000;

function closeTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return DEFAULT_CLOSE_TIMEOUT_MS;
  }
  return Math.min(MAX_CLOSE_TIMEOUT_MS, Math.max(1, Math.round(value)));
}

function reportCleanupError(
  logger: ShutdownLogger | undefined,
  err: unknown,
  work: string,
): void {
  logger?.error({ err }, `Failed to ${work} during graceful shutdown`);
}

async function closeHttpServer(
  server: ClosableHttpServer | Server,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const forceClose = () => {
      try {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      } catch {
        // The close callback still determines the normal outcome. A forced
        // close is best effort because shutdown is already time-bounded.
      }
      finish();
    };
    const timeout = setTimeout(forceClose, timeoutMs);
    timeout.unref?.();

    try {
      server.close((error?: Error) => finish(error));
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Own process signal registration and the one shutdown promise for an API
 * server. `install` is idempotent, so a repeated startup path cannot add
 * another SIGTERM/SIGINT listener. Cleanup callbacks run at most once.
 */
export function createGracefulShutdown(
  options: GracefulShutdownOptions,
): GracefulShutdownOwner {
  const signalSource = options.signalSource ?? process;
  const timeoutMs = closeTimeoutMs(options.closeTimeoutMs);
  let installed = false;
  let shutdownPromise: Promise<void> | undefined;
  const signalListeners = new Map<ShutdownSignal, () => void>();

  const removeSignalHandlers = () => {
    for (const [signal, listener] of signalListeners) {
      signalSource.removeListener?.(signal, listener);
    }
    signalListeners.clear();
    installed = false;
  };

  const shutdown = (signal?: ShutdownSignal): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      // A direct owner shutdown (for example, a test server restart) must not
      // leave stale process handlers behind for the next startup.
      removeSignalHandlers();
      if (options.stopMemoryDiagnostics) {
        try {
          options.stopMemoryDiagnostics();
        } catch (err) {
          reportCleanupError(options.logger, err, "stop memory diagnostics");
        }
      }
      if (options.disposeCollaboration) {
        try {
          options.disposeCollaboration();
        } catch (err) {
          reportCleanupError(options.logger, err, "dispose collaboration");
        }
      }
      if (options.disposeBackgroundWork) {
        try {
          options.disposeBackgroundWork();
        } catch (err) {
          reportCleanupError(options.logger, err, "dispose background work");
        }
      }
      await closeHttpServer(options.server, timeoutMs);
      if (signal) options.exit?.(0);
    })();
    return shutdownPromise;
  };

  const onSignal = (signal: ShutdownSignal) => {
    void shutdown(signal).catch((err) => {
      reportCleanupError(options.logger, err, `close HTTP server after ${signal}`);
      options.exit?.(1);
    });
  };

  return {
    install(): void {
      if (installed) return;
      installed = true;
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        const listener = () => onSignal(signal);
        signalListeners.set(signal, listener);
        signalSource.once(signal, listener);
      }
    },
    shutdown,
  };
}