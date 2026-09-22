import assert from "node:assert/strict";
import test from "node:test";

process.env.SESSION_SECRET ||= "drive-health-test-secret-that-is-long-enough";

test("Drive health classifies invalid_grant as requiring reauthorization", async () => {
  const { classifyDriveFailure } = await import("./googleDrive");
  assert.deepEqual(
    classifyDriveFailure(
      { response: { status: 400, data: { error: "invalid_grant", error_description: "sensitive provider text" } } },
      "refresh",
    ),
    { state: "reauth_required", reason: "oauth_refresh_rejected" },
  );
});

test("Drive health uses stable safe reasons for transient provider failures", async () => {
  const { classifyDriveFailure } = await import("./googleDrive");
  assert.deepEqual(
    classifyDriveFailure({ response: { status: 503, data: { error: "raw provider response" } } }, "upload"),
    { state: "transient_error", reason: "provider_unavailable" },
  );
  assert.deepEqual(
    classifyDriveFailure({ response: { status: 429 } }, "upload"),
    { state: "transient_error", reason: "provider_rate_limited" },
  );
});