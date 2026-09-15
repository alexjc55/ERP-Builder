import assert from "node:assert/strict";
import test from "node:test";
import {
  createGracefulShutdown,
  type ClosableHttpServer,
  type ShutdownSignal,
  type ShutdownSignalSource,
} from "./server-lifecycle";

class FakeSignalSource implements ShutdownSignalSource {
  readonly listeners = new Map<ShutdownSignal, () => void>();
  onceCount = new Map<ShutdownSignal, number>();

  once(signal: ShutdownSignal, listener: () => void): void {
    this.listeners.set(signal, listener);
    this.onceCount.set(signal, (this.onceCount.get(signal) ?? 0) + 1);
  }

  removeListener(signal: ShutdownSignal, listener: () => void): void {
    if (this.listeners.get(signal) === listener) this.listeners.delete(signal);
  }

  emit(signal: ShutdownSignal): void {
    this.listeners.get(signal)?.();
  }
}

class FakeServer implements ClosableHttpServer {
  closeCalls = 0;
  forcedIdleCloseCalls = 0;
  forcedAllCloseCalls = 0;
  closeCallback: ((error?: Error) => void) | undefined;

  close(callback?: (error?: Error) => void): void {
    this.closeCalls += 1;
    this.closeCallback = callback;
  }

  closeIdleConnections(): void {
    this.forcedIdleCloseCalls += 1;
  }

  closeAllConnections(): void {
    this.forcedAllCloseCalls += 1;
  }
}

test("shutdown owner installs signal handlers once and cleanup is idempotent", async () => {
  const signals = new FakeSignalSource();
  const server = new FakeServer();
  let stoppedDiagnostics = 0;
  let disposedCollaboration = 0;
  let disposedBackground = 0;
  const exits: number[] = [];
  const owner = createGracefulShutdown({
    server,
    signalSource: signals,
    stopMemoryDiagnostics: () => { stoppedDiagnostics += 1; },
    disposeCollaboration: () => { disposedCollaboration += 1; },
    disposeBackgroundWork: () => { disposedBackground += 1; },
    exit: (code) => exits.push(code),
  });

  owner.install();
  owner.install();
  assert.equal(signals.onceCount.get("SIGTERM"), 1);
  assert.equal(signals.onceCount.get("SIGINT"), 1);

  signals.emit("SIGTERM");
  signals.emit("SIGTERM");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(server.closeCalls, 1);
  server.closeCallback?.();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(stoppedDiagnostics, 1);
  assert.equal(disposedCollaboration, 1);
  assert.equal(disposedBackground, 1);
  assert.deepEqual(exits, [0]);
  assert.equal(signals.listeners.size, 0);
  await owner.shutdown();
  assert.equal(server.closeCalls, 1);
});

test("shutdown owner force-closes a server after the bounded grace period", async () => {
  const server = new FakeServer();
  const owner = createGracefulShutdown({
    server,
    closeTimeoutMs: 5,
  });

  await owner.shutdown();
  assert.equal(server.closeCalls, 1);
  assert.equal(server.forcedIdleCloseCalls, 1);
  assert.equal(server.forcedAllCloseCalls, 1);
});