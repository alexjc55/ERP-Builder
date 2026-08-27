import test from "node:test";
import assert from "node:assert/strict";
import { classifyInboundDuplicate, hashInboundSecret, parseInboundBearer, verifyInboundSecret } from "./inbound-auth";

test("opaque webhook bearer secrets are parsed, hashed and verified", () => {
  const secret = `whk_${"a".repeat(48)}`;
  const digest = hashInboundSecret(secret);
  assert.equal(parseInboundBearer(`Bearer ${secret}`), secret);
  assert.equal(parseInboundBearer(`Basic ${secret}`), null);
  assert.equal(parseInboundBearer("Bearer whk_short"), null);
  assert.equal(verifyInboundSecret(secret, digest), true);
  assert.equal(verifyInboundSecret(`${secret}x`, digest), false);
});

test("same event payload is idempotent and changed payload conflicts", () => {
  const first = hashInboundSecret('{"id":1}');
  assert.equal(classifyInboundDuplicate(first, first), "duplicate");
  assert.equal(classifyInboundDuplicate(first, hashInboundSecret('{"id":2}')), "conflict");
});