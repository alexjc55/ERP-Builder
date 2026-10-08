import assert from "node:assert/strict";
import { test } from "node:test";
import { revokedSessionGroup, addRevokedRequest } from "./revoked-session-summary";

const row = { action: "access.denied", outcome: "denied", statusCode: 401,
  authSource: "revoked-session", reason: "session_revoked_or_account_inactive",
  actorUserId: 5, sessionRef: "opaque-session", clientIp: "192.0.2.1",
  peerIp: "127.0.0.1", ipSource: "trusted-proxy", userAgent: "Browser" };

test("one revoked session shares a group across routes, but never across identities or sources", () => {
  const key = revokedSessionGroup(row);
  assert.ok(key);
  assert.deepEqual(revokedSessionGroup({ ...row, route: "/auth/me" }), key);
  for (const delta of [{ actorUserId: 6 }, { sessionRef: "another" },
    { clientIp: "192.0.2.2" }, { peerIp: "::1" }, { userAgent: "other" }]) {
    assert.notDeepEqual(revokedSessionGroup({ ...row, ...delta }), key);
  }
  for (const delta of [{ statusCode: 403 }, { outcome: "success" },
    { authSource: "unverified-token" }, { reason: "other" }, { sessionRef: null },
    { actorUserId: null }, { action: "user.update" }]) {
    assert.equal(revokedSessionGroup({ ...row, ...delta }), null);
  }
});

test("route counters retain every occurrence and explicitly bound distinct route detail", () => {
  let summary: Record<string, unknown> = { targetEntityId: 72 };
  for (let i = 0; i < 40; i++) summary = addRevokedRequest(summary, "GET", `/route-${i}`);
  summary = addRevokedRequest(summary, "GET", "/route-0");
  const requests = summary.requestSummary as { count: number }[];
  assert.equal(requests.length, 32);
  assert.equal(requests[0].count, 2);
  assert.equal(summary.omittedRequestCount, 8);
  assert.equal(summary.sourceDetailsTruncated, true);
  assert.equal(summary.targetEntityId, 72);
  assert.equal(requests.reduce((sum, r) => sum + r.count, 0) + Number(summary.omittedRequestCount), 41);
});
