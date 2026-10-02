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
  let queuedEffects: Array<() => void> = [];
  const timers = new Map<number, { callback: () => void; interval: boolean; delay?: number }>();
  let timerId = 0;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const presenceResponses: Array<Promise<Response>> = [];
  const streamResponses: Response[] = [];
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
      if (streamResponses.length) return streamResponses.shift();
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
    const result = exports.useCollaboration(pageId);
    const effects = queuedEffects;
    queuedEffects = [];
    effects.forEach(effect => effect());
    return result;
  };
  return {
    render, requests, presenceResponses, streamResponses, timers,
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
      assert.equal(h.timers.size, 1);
    }
    const before = h.requests.length;
    h.retryAccess();
    await settle();
    assert.equal(h.render().connected, true);
    assert.equal(h.requests.length, before + 2, "one stream and one fresh presence");
    assert.equal(JSON.parse(String(h.requests.at(-1)!.init.body)).editing, null);
    h.retryAccess();
    await settle();
    assert.equal(h.requests.length, before + 2, "no duplicate authorized stream");
    h.send("access_denied", {});
    await settle();
    h.streamResponses.push(new Response(null, { status: 401 }));
    h.retryAccess();
    await settle();
    assert.equal(h.timers.size, 0, "expired credentials do not poll");
  } finally { h.cleanup(); }
  const unmounted = harness();
  unmounted.render();
  await settle();
  unmounted.send("access_denied", {});
  await settle();
  unmounted.cleanup();
  assert.equal(unmounted.timers.size, 0);
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