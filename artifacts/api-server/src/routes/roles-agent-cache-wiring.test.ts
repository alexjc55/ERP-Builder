import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("only successful role mutations invalidate the agent cache", () => {
  const source = readFileSync(new URL("./roles.ts", import.meta.url), "utf8");
  const getRoute = source.slice(
    source.indexOf('router.get("/roles/:id"'),
    source.indexOf('router.put("/roles/:id"'),
  );
  const putRoute = source.slice(
    source.indexOf('router.put("/roles/:id"'),
    source.indexOf('router.delete("/roles/:id"'),
  );

  assert.doesNotMatch(getRoute, /invalidateAgentCache\(/);
  assert.match(
    putRoute,
    /if \(!role\) \{\s+res\.status\(404\)\.json\(\{ error: "Role not found" \}\);\s+return;\s+\}\s+invalidateAgentCache\(\);/,
  );
});