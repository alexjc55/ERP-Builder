import assert from "node:assert/strict";
import test from "node:test";
import { customFetch, setAuthTokenGetter, setUnauthorizedHandler } from "../lib/api-client-react/src/custom-fetch.ts";

test("401 reports the request credential, not a replacement; 403 and login do not expire it", async () => {
  const original = globalThis.fetch;
  let token = "first";
  const denied = [];
  setAuthTokenGetter(() => token);
  setUnauthorizedHandler(value => denied.push(value));
  try {
    globalThis.fetch = async () => {
      token = "replacement";
      return new Response('{"error":"Unauthorized"}', { status: 401 });
    };
    await assert.rejects(customFetch("/api/auth/me"));
    assert.deepEqual(denied, ["first"]);
    await assert.rejects(customFetch("/api/auth/login", { method: "POST" }));
    assert.deepEqual(denied, ["first"], "bad login is not session revocation");
    globalThis.fetch = async () => new Response(null, { status: 403 });
    await assert.rejects(customFetch("/api/records/1"));
    assert.deepEqual(denied, ["first"], "permission denial must not log out");
    setAuthTokenGetter(() => null);
    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(customFetch("/api/auth/me"));
    assert.deepEqual(denied, ["first"], "anonymous requests cannot invalidate a session");
  } finally {
    globalThis.fetch = original;
    setAuthTokenGetter(null);
    setUnauthorizedHandler(null);
  }
});
