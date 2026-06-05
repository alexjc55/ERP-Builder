import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-in-production";

export interface JwtPayload {
  userId: number;
  roleId: number;
  /** Set when this token was issued via impersonation; the original admin's user id. */
  impersonatorId?: number;
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
