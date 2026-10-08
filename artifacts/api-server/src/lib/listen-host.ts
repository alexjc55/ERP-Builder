import { isIP } from "node:net";

/** Preserve Node's existing wildcard listener unless explicitly configured.
 * Only literal IPs are allowed, so binding never depends on DNS resolution. */
export function resolveListenHost(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const host = raw.trim();
  if (!isIP(host)) {
    throw new Error("API_BIND_HOST must be a literal IPv4 or IPv6 address");
  }
  return host;
}
