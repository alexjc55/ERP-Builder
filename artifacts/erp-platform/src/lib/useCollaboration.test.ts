import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the real hook in an isolated, minimal hooks runtime. All transport
// responses below are unit fixtures; no browser, API or database is contacted.
function harness() {
  const slots: any[] = [];
  let cursor = 0;
  let pageId = 10;
  let configInvalidations = 0;
  const invalidatedTokens: string[] = [];
  let queuedEffects: Array<() => void> = [];
  const timers = new Map<number, { callback: () => void; interval: boolean; delay?: number }>();
  let timerId = 0;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const presenceResponses: Array<Promise<Response>> = [];
  const streamResponses: Array<Response | Error> = [];
  const dependenciesEqual = (a: unknown[], b: unknown[]) =>
    a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !dependenciesEqual(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++;
      if (!slots[index] || !dependenciesEqual(slots[index].deps, deps)) {
        slots[index]?.cleanup?.();
        slots[index] = { deps };
        queuedEffects.push(() => { slots[index].cleanup = effect(); });
      }
    },
  };
  const storage = { getItem: (key: string) => key === "erp_token" ? "unit-token" : "unit-client", setItem() {} };
  const exports: any = {};
  const context = vm.createContext({
    exports,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "@/lib/auth") return { useAuth: () => ({ user: { id: 1 }, isGuest: false }) };
      if (name === "@workspace/api-client-react") return { notifyUnauthorized: (token: string) => invalidatedTokens.push(token) };
      throw new Error(`Unexpected dependency ${name}`);
    },
    sessionStorage: storage, localStorage: storage,
    crypto: { randomUUID: () => "unit-client" },
    AbortController, TextDecoder, console,
    window: {
      setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, interval: false, delay }); return timerId; },
      setInterval: (callback: () => void) => { timers.set(++timerId, { callback, interval: true }); return timerId; },
      clearTimeout: (id: number) => timers.delete(id),
      clearInterval: (id: number) => timers.delete(id),
    },
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/presence")) return presenceResponses.shift() ?? new Response(null, { status: 204 });
      if (streamResponses.length) {
        const next = streamResponses.shift();
        if (next instanceof Error) throw next;
        return next;
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller);
          init.signal?.addEventListener("abort", () => {
            try { controller.close(); } catch { /* Reader already closed. */ }
          });
        },
      });
      return new Response(body, { status: 200 });
    },
  });
  const compiled = ts.transpileModule(readFileSync(new URL("./useCollaboration.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(compiled, context);
  const render = () => {
    cursor = 0;
    const result = exports.useCollaboration(pageId, () => { configInvalidations++; });
    const effects = queuedEffects;
    queuedEffects = [];
    effects.forEach(effect => effect());
    return result;
  };
  return {
    render, requests, presenceResponses, streamResponses, timers, invalidatedTokens,
    get configInvalidations() { return configInvalidations; },
    retryAccess() {
      for (const [id, timer] of [...timers]) if (timer.delay === 30_000) {
        timers.delete(id);
        timer.callback();
      }
      render();
    },
    changePage(next: number) { pageId = next; render(); },
    send(event: string, data: unknown) {
      streams.at(-1)!.enqueue(new TextEncoder().encode(`event:${event}\ndata:${JSON.stringify(data)}\n\n`));
    },
    heartbeat() { [...timers.values()].filter(timer => timer.interval).forEach(timer => timer.callback()); },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const editing = { entityId: 2, recordId: 3, fieldKey: "title", source: "entity" };
const presence = [{ userId: 2, name: "Bob", color: "#123456", editing }];

test("configuration invalidations survive batched record events and snapshots repair missed settings", async () => {
  const h = harness();
  try {
    h.render();
    await settle();
    h.send("snapshot", { presence: [] });
    h.send("page_config_changed", {});
    h.send("table_changed", {});
    await settle();
    assert.equal(h.configInvalidations, 2);
    assert.equal(h.render().lastMessage.type, "table_changed");
    h.changePage(11);
    await settle();
    h.send("snapshot", { presence: [] });
    await settle();
    assert.equal(h.configInvalidations, 3);
  } finally { h.cleanup(); }
});

test("SSE denial clears presence/messages/editing and stops heartbeat/fast reconnect", async () => {
  const h = harness();
  try {
    h.render();
    await settle();
    h.send("presence", { presence });
    h.send("table_changed", {});
    await settle();
    assert.equal(h.render().users.length, 1);
    assert.equal(h.render().lastMessage.type, "table_changed");
    h.render().publishPresence(editing);
    await settle();
    h.send("access_denied", { error: "Forbidden" });
    await settle();
    const denied = h.render();
    assert.equal(denied.connected, false);
    assert.equal(denied.users.length, 0);
    assert.equal(denied.lastMessage, null);
    assert.equal(denied.subscriptionKey, null);
    assert.equal(denied.subscriptionPending, false);
    const attempts = h.requests.length;
    h.heartbeat();
    denied.publishPresence(editing);
    await settle();
    assert.equal(h.requests.length, attempts);
    assert.equal(h.timers.size, 1, "only the slow access probe remains");
  } finally {
    h.cleanup();
  }
});

test("three 403 attempts recover cleanly; 401 and unmount cancel access probes", async () => {
  const h = harness();
  try {
    h.render();
    await settle();
    h.render().publishPresence(editing);
    await settle();
    h.send("access_denied", {});
    await settle();
    for (let i = 0; i < 3; i++) {
      h.streamResponses.push(new Response(null, { status: 403 }));
      h.retryAccess();
      await settle();
      assert.equal(h.render().connected, false);
      assert.equal(h.render().failureReason, "access_denied");
      assert.equal(h.timers.size, 1);
    }
    for (const failedProbe of [new Response(null, { status: 503 }), new Error("offline")]) {
      h.streamResponses.push(failedProbe);
      h.retryAccess();
      await settle();
      assert.equal(h.render().failureReason, "access_denied");
      assert.equal(h.render().users.length, 0);
      const writes = h.requests.filter(request => request.url.endsWith("/presence")).length;
      h.heartbeat();
      await settle();
      assert.equal(h.requests.filter(request => request.url.endsWith("/presence")).length, writes);
    }
    const afterFailures = h.requests.length;
    h.retryAccess();
    await settle();
    assert.equal(h.render().connected, true);
    assert.equal(h.render().failureReason, null);
    assert.equal(h.requests.length, afterFailures + 2, "one stream and one fresh presence");
    assert.equal(JSON.parse(String(h.requests.at(-1)!.init.body)).editing, null);
    h.retryAccess();
    await settle();
    assert.equal(h.requests.length, afterFailures + 2, "no duplicate authorized stream");
    h.send("access_denied", {});
    await settle();
    h.streamResponses.push(new Response(null, { status: 401 }));
    h.retryAccess();
    await settle();
    assert.equal(h.timers.size, 0, "expired credentials do not poll");
    assert.equal(h.render().failureReason, "session_expired");
    assert.deepEqual(h.invalidatedTokens, ["unit-token"]);
  } finally { h.cleanup(); }
  const unmounted = harness();
  unmounted.render();
  await settle();
  unmounted.send("access_denied", {});
  await settle();
  unmounted.cleanup();
  assert.equal(unmounted.timers.size, 0);
});

test("401 presence response invalidates the session and stops all timers", async () => {
  const h = harness();
  try {
    h.render();
    await settle();
    h.presenceResponses.push(Promise.resolve(new Response(null, { status: 401 })));
    h.heartbeat();
    await settle();
    assert.deepEqual(h.invalidatedTokens, ["unit-token"]);
    assert.equal(h.timers.size, 0);
    assert.equal(h.render().failureReason, "session_expired");
  } finally { h.cleanup(); }
});

test("denied heartbeat tears down an otherwise-open stream and stale heartbeat cannot deny a new page", async () => {
  const h = harness();
  let resolve!: (response: Response) => void;
  try {
    h.render();
    await settle();
    h.send("presence", { presence });
    await settle();
    h.presenceResponses.push(new Promise(done => { resolve = done; }));
    h.heartbeat();
    await settle();
    h.changePage(11);
    await settle();
    resolve(new Response(null, { status: 403 }));
    await settle();
    assert.equal(h.render().connected, true, "late page-10 denial must not abort page 11");
    h.send("presence", { presence });
    await settle();
    h.presenceResponses.push(Promise.resolve(new Response(null, { status: 403 })));
    h.heartbeat();
    await settle();
    assert.equal(h.render().connected, false);
    assert.equal(h.render().users.length, 0);
    assert.equal(h.render().lastMessage, null);
    const attempts = h.requests.length;
    h.heartbeat();
    await settle();
    assert.equal(h.requests.length, attempts);
    assert.equal(h.timers.size, 1, "only the slow access probe remains");
  } finally {
    h.cleanup();
  }
});