import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { APP_SECRET } from "./secret";

const SECRET = APP_SECRET;

export interface JwtPayload {
  sessionVersion?: number;
  impersonatorSessionVersion?: number;
  userId: number;
  roleId: number;
  /** Set when this token was issued via impersonation; the original admin's user id. */
  impersonatorId?: number;
  /** Set when this token was issued via a passwordless guest link. Read-only access. */
  guest?: boolean;
  /** Set when the request is authenticated with an AI-agent API key (not a JWT). */
  agentId?: number;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign({ sessionVersion: 0, ...payload }, SECRET, { expiresIn: "7d", algorithm: "HS256", jwtid: randomUUID() });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET, { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || !Number.isSafeInteger(decoded.userId) || decoded.userId <= 0 ||
        !Number.isSafeInteger(decoded.roleId) || decoded.roleId <= 0 ||
        !Number.isSafeInteger(decoded.sessionVersion) || decoded.sessionVersion < 0 ||
        typeof decoded.exp !== "number" ||
        (decoded.impersonatorId !== undefined && (
          !Number.isSafeInteger(decoded.impersonatorId) || decoded.impersonatorId <= 0 ||
          !Number.isSafeInteger(decoded.impersonatorSessionVersion) || decoded.impersonatorSessionVersion < 0
        ))) return null;
    return decoded as JwtPayload;
  } catch {
    return null;
  }
}
