import { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "../lib/jwt";
import { AI_AGENT_KEY_PREFIX, resolveAgentKey, isAllowedByMask } from "../lib/aiAgentAuth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { BoundedTtlCache } from "../lib/bounded-ttl-cache";

/**
 * A JWT stays valid for days, but the account behind it can be deleted (e.g.
 * merged away as a duplicate) or blocked meanwhile. Verify the account still
 * exists and is active, with a short in-memory cache so the check costs one
 * DB read per user per minute, not per request.
 */
const USER_ALIVE_TTL_MS = 60_000;
// A high cap contains a token-spray workload without shortening the one-minute
// authorization freshness window for entries that remain cached.
const userAliveCache = new BoundedTtlCache<number, boolean>({
  ttlMs: USER_ALIVE_TTL_MS,
  maxEntries: 10_000,
});

async function isUserAlive(userId: number): Promise<boolean> {
  const cached = userAliveCache.get(userId);
  if (cached !== undefined) return cached;
  const generation = userAliveCache.generation;
  const [row] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const ok = row?.isActive === true;
  userAliveCache.setIfCurrent(generation, userId, ok);
  return ok;
}

/** Drop the cached "alive" verdict for a user (call after delete/block/merge). */
export function invalidateUserAliveCache(userId: number): void {
  userAliveCache.invalidate(userId);
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

/** Requests a guest token is allowed to make: any GET, or explicitly read-only POST queries. */
function isGuestReadSafe(req: Request): boolean {
  if (req.method === "GET") return true;
  if (req.method === "POST" && /\/records\/query$/.test(req.path)) return true;
  if (req.method === "POST" && /\/pages\/\d+\/record-values\/query$/.test(req.path)) return true;
  return false;
}
