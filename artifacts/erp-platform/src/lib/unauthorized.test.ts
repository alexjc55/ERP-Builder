import assert from "node:assert/strict";
import test from "node:test";
import { customFetch, subscribeUnauthorized, setUnauthorizedHandler } from "../../../../lib/api-client-react/src/custom-fetch";

test("only authenticated 401 stops readers before session teardown; listeners clean up", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const unsubscribe = subscribeUnauthorized(token => { calls.push(`stop:${token}`); });
  setUnauthorizedHandler(token => { calls.push(`logout:${token}`); });
  try {
    for (const status of [403, 500, 401]) {
      globalThis.fetch = async () => new Response("{}", { status, headers: { "Content-Type": "application/json" } });
      await assert.rejects(customFetch("/api/protected", { headers: { Authorization: "Bearer fixture" } }));
    }
    assert.deepEqual(calls, ["stop:fixture", "logout:fixture"]);
    calls.length = 0;
    globalThis.fetch = async () => { throw new TypeError("Network offline"); };
    await assert.rejects(customFetch("/api/protected", { headers: { Authorization: "Bearer fixture" } }));
    assert.equal(calls.length, 0);
    unsubscribe();
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    await assert.rejects(customFetch("/api/protected", { headers: { Authorization: "Bearer fixture" } }));
    assert.deepEqual(calls, ["logout:fixture"]);
  } finally {
    unsubscribe();
    setUnauthorizedHandler(null);
    globalThis.fetch = originalFetch;
  }
});
