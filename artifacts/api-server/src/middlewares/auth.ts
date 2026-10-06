import { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "../lib/jwt";
import { AI_AGENT_KEY_PREFIX, resolveAgentKey, isAllowedByMask, invalidateAgentCache } from "../lib/aiAgentAuth";
import { isUserSessionCurrent } from "../lib/user-sessions";
import { securityReason, securityVerifiedIdentity } from "../lib/security-audit";
/** Compatibility hook for account mutations: JWT state is now read live.
 * Machine identities still have a bounded cache, which must be cleared. */
export function invalidateUserAliveCache(_userId: number): void {
  invalidateAgentCache();
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
    securityReason(req, "missing_credentials");
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
          securityReason(req, "invalid_agent_key");
          res.status(401).json({ error: "Invalid or revoked agent key" });
          return;
        }
        securityVerifiedIdentity(req, agent.payload, "agent");
        if (!isAllowedByMask(req, agent.mask)) {
          securityReason(req, "agent_mask_denied");
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
    securityReason(req, "invalid_or_expired_token");
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Defense-in-depth: a passwordless guest token is strictly read-only. Even if a
  // Guest role were ever misconfigured with write/admin perms, the token itself
  // cannot reach any mutating endpoint. Reads are GET, plus the records query
  // endpoint which is a POST by design.
  if (payload.guest && !isGuestReadSafe(req)) {
    securityVerifiedIdentity(req, payload, "guest");
    securityReason(req, "guest_read_only");
    res.status(403).json({ error: "Guest access is read-only" });
    return;
  }

  isUserSessionCurrent(payload)
    .then((alive) => {
      if (!alive) {
        securityVerifiedIdentity(req, payload, "revoked-session");
        securityReason(req, "session_revoked_or_account_inactive");
        res.status(401).json({ error: "Session revoked or account inactive" });
        return;
      }
      req.user = payload;
      securityVerifiedIdentity(req, payload);
      next();
    })
    .catch(next);
}

/** Requests a guest token is allowed to make: any GET, or explicitly read-only POST queries. */
function isGuestReadSafe(req: Request): boolean {
  if (req.method === "POST" && req.path === "/card-templates/resolve" && req.body?.mode === "view") return true;
  if (req.method === "GET") return true;
  if (req.method === "POST" && /\/records\/query$/.test(req.path)) return true;
  if (req.method === "POST" && /\/pages\/\d+\/record-values\/query$/.test(req.path)) return true;
  return false;
}
