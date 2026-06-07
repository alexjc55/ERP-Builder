import jwt from "jsonwebtoken";
import { APP_SECRET } from "./secret";

const SECRET = APP_SECRET;

export interface JwtPayload {
  userId: number;
  roleId: number;
  /** Set when this token was issued via impersonation; the original admin's user id. */
  impersonatorId?: number;
  /** Set when this token was issued via a passwordless guest link. Read-only access. */
  guest?: boolean;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, SECRET) as JwtPayload;
  } catch {
    return null;
  }
}
