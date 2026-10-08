import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolveListenHost } from "./listen-host";

test("unset bind host preserves the existing Node/Replit listener", () => {
  assert.equal(resolveListenHost(undefined), undefined);
});

test("literal IPv4 and IPv6 addresses are accepted", () => {
  for (const host of ["127.0.0.1", "0.0.0.0", "::1", "::"]) {
    assert.equal(resolveListenHost(host), host);
  }
  assert.equal(resolveListenHost(" 127.0.0.1 "), "127.0.0.1");
});

test("invalid or blank configuration fails rather than opening a wildcard listener", () => {
  for (const host of ["", " ", "localhost", "127.0.0.1:10000", "127.0.0.1/32", "https://example.com", "256.0.0.1"]) {
    assert.throws(() => resolveListenHost(host), /API_BIND_HOST/);
  }
});

test("loopback listener accepts local HTTP without a wildcard binding", async () => {
  const server = createServer((_req, res) => res.end("ok"));
  server.listen({ port: 0, host: resolveListenHost("127.0.0.1") });
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
