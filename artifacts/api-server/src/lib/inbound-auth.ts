import { createHash, timingSafeEqual } from "crypto";

export const INBOUND_SECRET_PREFIX = "whk_";
export const hashInboundSecret = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

export function parseInboundBearer(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.startsWith(INBOUND_SECRET_PREFIX) && token.length >= 40 ? token : null;
}

export function verifyInboundSecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashInboundSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function classifyInboundDuplicate(existingHash: string, incomingHash: string): "duplicate" | "conflict" {
  return existingHash === incomingHash ? "duplicate" : "conflict";
}