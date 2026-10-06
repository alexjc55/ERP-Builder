import { BlockList, isIP } from "node:net";
import type { Request } from "express";

function normalize(value: string) {
  return value.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
}

/** Only explicitly configured proxy networks may supply an IP chain. Never trust
 * the left-most forwarded address from an arbitrary Internet client. */
export function createSecurityIpResolver(cidrs: string) {
  const trusted = new BlockList();
  const entries = cidrs.split(",").map((v) => v.trim()).filter(Boolean);
  for (const entry of entries) {
    const [raw, prefix, extra] = entry.split("/");
    const ip = normalize(raw!);
    const family = isIP(ip);
    const bits = prefix === undefined ? (family === 4 ? 32 : 128) : Number(prefix);
    if (!family || extra !== undefined || !Number.isInteger(bits) || bits <= 0 || bits > (family === 4 ? 32 : 128)) {
      throw new Error("Invalid SECURITY_TRUSTED_PROXY_CIDRS; use explicit proxy IPs or CIDRs, never /0");
    }
    trusted.addSubnet(ip, bits, family === 4 ? "ipv4" : "ipv6");
  }
  const isTrusted = (ip: string) => {
    const family = isIP(ip);
    return !!family && trusted.check(ip, family === 4 ? "ipv4" : "ipv6");
  };
  return {
    configured: entries.length > 0,
    resolve(peer: string, forwarded?: string) {
      const peerIp = normalize(peer || "unknown");
      if (!forwarded || !isTrusted(peerIp)) return {
        peerIp, clientIp: peerIp, ipSource: forwarded ? "untrusted-forwarded-ignored" : "socket",
      };
      const chain = forwarded.split(",").map((part) => normalize(part.trim()));
      if (chain.length > 32 || chain.some((ip) => !isIP(ip))) {
        return { peerIp, clientIp: peerIp, ipSource: "invalid-forwarded-ignored" };
      }
      let current = peerIp;
      for (let i = chain.length - 1; i >= 0 && isTrusted(current); i--) current = chain[i]!;
      return { peerIp, clientIp: current, ipSource: "trusted-proxy" };
    },
  };
}

const resolver = createSecurityIpResolver(process.env.SECURITY_TRUSTED_PROXY_CIDRS ?? "");
export const securityProxyAttribution = resolver.configured ? "trusted-proxy" : "socket-only";
export function securityRequestIp(req: Request) {
  return resolver.resolve(req.socket.remoteAddress ?? "", req.header("x-forwarded-for"));
}
