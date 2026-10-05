import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverWebhook, isBlockedWebhookAddress, validWebhookUrl } from "./webhook-delivery";
import { syntheticFieldValue } from "./webhook-test-payload";

test("webhook URL rejects email, credentials and non-HTTP schemes", () => {
  for (const url of ["bad", "foo@hook.example", "https://token@hook.example", "ftp://example.com/a"]) {
    assert.equal(validWebhookUrl(url), false);
  }
  assert.equal(validWebhookUrl("https://example.com/hook?key=test"), true);
});
test("SSRF blocks private, loopback, metadata and mapped IPv6 addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.1.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "::", "::1", "fe90::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    assert.equal(isBlockedWebhookAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isBlockedWebhookAddress(ip), false);
});
test("blocked destinations are rejected without dispatch", async () => {
  assert.deepEqual(await deliverWebhook("http://127.0.0.1/secret", {}), { ok: false, error: "blocked_address" });
  assert.deepEqual(await deliverWebhook("https://token@host.test", {}), { ok: false, error: "invalid_url" });
});
test("synthetic scalar examples preserve primitive types and select values", () => {
  const sample = (fieldType: string, optionsJson: unknown = []) =>
    syntheticFieldValue({ fieldType, optionsJson });
  assert.equal(typeof sample("number"), "number");
  assert.equal(typeof sample("percent"), "number");
  assert.equal(sample("boolean"), true);
  assert.equal(sample("select", [{ value: "ready", labelJson: { en: "Ready" } }]), "ready");
  assert.deepEqual(sample("multiselect", ["legacy"]), ["legacy"]);
  assert.equal(sample("user"), 0);
  assert.equal(sample("text"), "TEST");
});
