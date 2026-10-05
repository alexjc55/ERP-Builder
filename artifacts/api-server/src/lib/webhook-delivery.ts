import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16],
  ["192.0.0.0", 24], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(ip, prefix, "ipv6");

export function isBlockedWebhookAddress(address: string) {
  const family = isIP(address);
  return !family || blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}
export function validWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
export type WebhookDeliveryResult = { ok: boolean; statusCode?: number; error?: string };

/** Never follow redirects or log URLs/bodies. Pin the validated DNS answer to
 * the connection, preserving Host and TLS hostname verification. */
export async function deliverWebhook(url: string, payload: unknown): Promise<WebhookDeliveryResult> {
  if (!validWebhookUrl(url)) return { ok: false, error: "invalid_url" };
  const target = new URL(url);
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
    ]);
    if (!addresses.length || addresses.some(a => isBlockedWebhookAddress(a.address))) {
      return { ok: false, error: "blocked_address" };
    }
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > 2_000_000) return { ok: false, error: "payload_too_large" };
    return await new Promise<WebhookDeliveryResult>(resolve => {
      const send = target.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(target, {
        method: "POST", agent: false, signal: controller.signal,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0]!.address, addresses[0]!.family);
        },
      }, res => {
        const statusCode = res.statusCode ?? 0;
        res.destroy(); // Only the HTTP status is needed; never expose receiver bodies.
        resolve({ ok: statusCode >= 200 && statusCode < 300, statusCode,
          ...(statusCode >= 200 && statusCode < 300 ? {} : { error: statusCode >= 300 && statusCode < 400 ? "redirect_not_allowed" : "http_error" }) });
      });
      req.on("error", () => resolve({ ok: false, error: controller.signal.aborted ? "timeout" : "network_error" }));
      req.end(body);
    });
  } catch {
    return { ok: false, error: controller.signal.aborted ? "timeout" : "dns_error" };
  } finally { clearTimeout(timer); }
}
