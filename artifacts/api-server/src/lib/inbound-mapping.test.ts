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

test("file mappings are restricted to valid entity file DSL entries", () => {
  const page = validateInboundMapping({ steps: [{
    key: "page", operation: "update", target: { kind: "page", entityId: 1, pageId: 2 },
    files: [{ fieldKey: "attachment", source: "files", tag: "contract" }],
  }] });
  assert.equal(page.ok, false);
  const entity = validateInboundMapping({ steps: [{
    key: "order", operation: "upsert", target: { kind: "entity", entityId: 1 },
    files: [{ fieldKey: "attachment", source: "files", tag: "contract" }], updateOnMatch: false,
  }] });
  assert.equal(entity.ok, true);
  const malformed = validateInboundMapping({ steps: [{
    key: "order", operation: "upsert", target: { kind: "entity", entityId: 1 },
    files: [{ fieldKey: "Bad-Key", source: "", tag: "" }],
  }] });
  assert.equal(malformed.ok, false);
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

test("system-id match maximum is accepted only as a positive exclusive bound", () => {
  const valid = validateInboundMapping({
    steps: [{
      key: "client",
      operation: "upsert",
      target: { kind: "entity", entityId: 4 },
      matches: [{
        kind: "system_id",
        value: { operand: { kind: "source", path: "legacyId" } },
        maxValueExclusive: 1_000,
        onMissingExplicitId: "continue",
      }],
    }],
  });
  assert.equal(valid.ok, true);

  const invalid = validateInboundMapping({
    steps: [{
      key: "client",
      operation: "upsert",
      target: { kind: "entity", entityId: 4 },
      matches: [{ kind: "fields", conditions: [{ fieldKey: "email", value: { operand: { kind: "source", path: "email" } } }], maxValueExclusive: 0 }],
    }],
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.errors.some((error) => error.includes("maxValueExclusive")));
});

test("user mappings accept the supported profile keys without widening entity field keys", () => {
  const userMapping = validateInboundMapping({
    steps: [{
      key: "manufacturer",
      operation: "find",
      target: { kind: "user", fieldId: 12, roleId: 4 },
      matches: [{ kind: "fields", conditions: [{ fieldKey: "firstName", value: { operand: { kind: "source", path: "manufacturer" } } }] }],
      values: {
        email: { operand: { kind: "source", path: "email" } },
        firstName: { operand: { kind: "source", path: "manufacturer" } },
      },
    }],
  });
  assert.equal(userMapping.ok, true);

  const entityMapping = validateInboundMapping({
    steps: [{
      key: "record",
      operation: "create",
      target: { kind: "entity", entityId: 4 },
      values: { firstName: { operand: { kind: "source", path: "name" } } },
    }],
  });
  assert.equal(entityMapping.ok, false);
});

test("step labels are optional display metadata with a bounded non-empty value", () => {
  const valid = validateInboundMapping({
    steps: [{
      key: "project",
      label: "Создать или найти проект",
      operation: "find",
      target: { kind: "entity", entityId: 73 },
      matches: [{ kind: "system_id", value: { operand: { kind: "source", path: "project_id" } } }],
    }],
  });
  assert.equal(valid.ok, true);

  const invalid = validateInboundMapping({
    steps: [{
      key: "project",
      label: "   ",
      operation: "find",
      target: { kind: "entity", entityId: 73 },
    }],
  });
  assert.equal(invalid.ok, false);
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