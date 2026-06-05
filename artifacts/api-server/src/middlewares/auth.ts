import { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Defense-in-depth: a passwordless guest token is strictly read-only. Even if a
  // Guest role were ever misconfigured with write/admin perms, the token itself
  // cannot reach any mutating endpoint. Reads are GET, plus the records query
  // endpoint which is a POST by design.
  if (payload.guest && !isGuestReadSafe(req)) {
    res.status(403).json({ error: "Guest access is read-only" });
    return;
  }

  req.user = payload;
  next();
}

/** Requests a guest token is allowed to make: any GET, or the POST records-query read. */
function isGuestReadSafe(req: Request): boolean {
  if (req.method === "GET") return true;
  if (req.method === "POST" && /\/records\/query$/.test(req.path)) return true;
  return false;
}
