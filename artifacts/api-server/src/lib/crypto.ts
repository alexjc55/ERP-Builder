import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { APP_SECRET } from "./secret";

/**
 * Symmetric encryption for secrets at rest (Google Drive OAuth client secret and
 * refresh token). Uses AES-256-GCM with a key derived from SESSION_SECRET, so no
 * extra key material has to be provisioned. Output format is a single string:
 *   base64(salt).base64(iv).base64(authTag).base64(ciphertext)
 * The per-value random salt means the derived key differs per value.
 */
function deriveKey(salt: Buffer): Buffer {
  return scryptSync(APP_SECRET, salt, 32);
}

export function encryptSecret(plaintext: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4) throw new Error("Malformed encrypted payload");
  const [salt, iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64"));
  const key = deriveKey(salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
