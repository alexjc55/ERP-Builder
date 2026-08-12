import { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "../lib/jwt";
import { AI_AGENT_KEY_PREFIX, resolveAgentKey, isAllowedByMask } from "../lib/aiAgentAuth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * A JWT stays valid for days, but the account behind it can be deleted (e.g.
 * merged away as a duplicate) or blocked meanwhile. Verify the account still
 * exists and is active, with a short in-memory cache so the check costs one
 * DB read per user per minute, not per request.
 */
const USER_ALIVE_TTL_MS = 60_000;
const userAliveCache = new Map<number, { ok: boolean; ts: number }>();

async function isUserAlive(userId: number): Promise<boolean> {
  const cached = userAliveCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.ts < USER_ALIVE_TTL_MS) return cached.ok;
  const [row] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const ok = row?.isActive === true;
  userAliveCache.set(userId, { ok, ts: now });
  return ok;
}

/** Drop the cached "alive" verdict for a user (call after delete/block/merge). */
export function invalidateUserAliveCache(userId: number): void {
  userAliveCache.delete(userId);
}

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

  // AI-agent API keys are opaque tokens (never JWTs). They resolve to the
  // agent's backing user account, so all RBAC boundaries apply as usual; the
  // capability mask is an extra hard method-level guard on top.
  if (token.startsWith(AI_AGENT_KEY_PREFIX)) {
    resolveAgentKey(token)
      .then((agent) => {
        if (!agent) {
          res.status(401).json({ error: "Invalid or revoked agent key" });
          return;
        }
        if (!isAllowedByMask(req, agent.mask)) {
          res.status(403).json({ error: "Agent key does not permit this operation" });
          return;
        }
        req.user = agent.payload;
        next();
      })
      .catch(next);
    return;
  }

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

  isUserAlive(payload.userId)
    .then((alive) => {
      if (!alive) {
        res.status(401).json({ error: "Account no longer active" });
        return;
      }
      req.user = payload;
      next();
    })
    .catch(next);
}

/** Requests a guest token is allowed to make: any GET, or the POST records-query read. */
function isGuestReadSafe(req: Request): boolean {
  if (req.method === "GET") return true;
  if (req.method === "POST" && /\/records\/query$/.test(req.path)) return true;
  return false;
}
