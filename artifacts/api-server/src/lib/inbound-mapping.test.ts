import test from "node:test";
import assert from "node:assert/strict";
import { readInboundPath, resolveInboundValue, validateInboundMapping } from "./inbound-mapping";
import { isPrivilegedRole } from "../middlewares/permissions";
import { NO_ACCESS_PERMS } from "@workspace/db";

test("source paths support objects and arrays without prototype traversal", () => {
  const payload = { order: { lines: [{ sku: " A-1 " }] } };
  assert.equal(readInboundPath(payload, "$.order.lines[0].sku"), " A-1 ");
  assert.equal(readInboundPath(payload, "__proto__.polluted"), undefined);
});

test("restricted transforms and prior step results resolve deterministically", () => {
  const results = new Map([["client", { id: 42 }]]);
  assert.equal(resolveInboundValue(
    { operand: { kind: "source", path: "email" }, transforms: ["trim", "normalize_email"] },
    { email: " TEST@Example.COM " },
    results,
  ), "test@example.com");
  assert.equal(resolveInboundValue({ operand: { kind: "result", step: "client" } }, {}, results), 42);
});

test("mapping rejects unknown transforms, duplicate keys and forward references", () => {
  const result = validateInboundMapping({
    steps: [
      {
        key: "one", operation: "upsert", target: { kind: "entity", entityId: 1 },
        values: { name: { operand: { kind: "result", step: "later" }, transforms: ["eval"] } },
      },
      { key: "one", operation: "create", target: { kind: "entity", entityId: 2 } },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.length >= 3);
});

test("explicit ERP id fallback must be configured and user roles are server-side", () => {
  const mapping = validateInboundMapping({
    steps: [{
      key: "client",
      operation: "upsert",
      target: { kind: "entity", entityId: 4 },
      matches: [{
        kind: "system_id",
        value: { operand: { kind: "source", path: "erpId" } },
        onMissingExplicitId: "continue",
      }],
    }, {
      key: "owner",
      operation: "upsert",
      target: { kind: "user", fieldId: 9, roleId: 3 },
      values: { email: { operand: { kind: "source", path: "email" } } },
    }],
  });
  assert.equal(mapping.ok, true);
});

test("hierarchy links may only point at prior fixed step results", () => {
  const ok = validateInboundMapping({
    steps: [
      { key: "client", operation: "upsert", target: { kind: "entity", entityId: 1 } },
      { key: "project", operation: "upsert", target: { kind: "entity", entityId: 2 }, links: [{ relationId: 3, toStep: "client" }] },
    ],
  });
  assert.equal(ok.ok, true);
  const bad = validateInboundMapping({
    steps: [{ key: "project", operation: "upsert", target: { kind: "entity", entityId: 2 }, links: [{ relationId: 3, toStep: "client" }] }],
  });
  assert.equal(bad.ok, false);
});

test("inline user creation privilege guard recognizes every admin capability", () => {
  assert.equal(isPrivilegedRole(NO_ACCESS_PERMS), false);
  assert.equal(isPrivilegedRole({
    ...NO_ACCESS_PERMS,
    admin: { ...NO_ACCESS_PERMS.admin, inboundIntegrations: true },
  }), true);
});