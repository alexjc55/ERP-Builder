import { createHash, randomBytes } from "crypto";
import type { Request } from "express";
import { db, aiAgentsTable, usersTable, modulesTable, type AiAgentMask } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { JwtPayload } from "./jwt";

/** AI-agent API keys are opaque bearer tokens with this prefix (never JWTs). */
export const AI_AGENT_KEY_PREFIX = "agk_";
export const AI_AGENTS_MODULE_KEY = "ai_agents";

export function hashAgentKey(plainKey: string): string {
  return createHash("sha256").update(plainKey).digest("hex");
}

export function generateAgentKey(): { plainKey: string; tokenHash: string; tokenPrefix: string } {
  const plainKey = AI_AGENT_KEY_PREFIX + randomBytes(24).toString("hex");
  return { plainKey, tokenHash: hashAgentKey(plainKey), tokenPrefix: plainKey.slice(0, 12) + "…" };
}

interface CachedAgent {
  payload: JwtPayload | null;
  mask: AiAgentMask;
  ts: number;
}

/**
 * Key lookups are cached briefly (like the user-alive cache) so agent traffic
 * costs one DB round-trip per key per minute. Revocation/deactivation therefore
 * takes effect within AGENT_CACHE_TTL_MS at worst; explicit invalidation on
 * admin changes makes it immediate in the common case.
 */
const AGENT_CACHE_TTL_MS = 60_000;
const agentCache = new Map<string, CachedAgent>();

export function invalidateAgentCache(): void {
  agentCache.clear();
}

async function isAiAgentsModuleEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ isEnabled: modulesTable.isEnabled })
    .from(modulesTable)
    .where(eq(modulesTable.moduleKey, AI_AGENTS_MODULE_KEY))
    .limit(1);
  return row?.isEnabled === true;
}

/**
 * Resolve an AI-agent API key into an auth payload. Returns null when the key
 * is unknown/revoked, the agent or its backing account is inactive, or the
 * ai_agents module is switched off.
 */
export async function resolveAgentKey(plainKey: string): Promise<{ payload: JwtPayload; mask: AiAgentMask } | null> {
  const tokenHash = hashAgentKey(plainKey);
  const cached = agentCache.get(tokenHash);
  const now = Date.now();
  if (cached && now - cached.ts < AGENT_CACHE_TTL_MS) {
    return cached.payload ? { payload: cached.payload, mask: cached.mask } : null;
  }

  let payload: JwtPayload | null = null;
  let mask: AiAgentMask = "read";

  if (await isAiAgentsModuleEnabled()) {
    const [row] = await db
      .select({
        agentId: aiAgentsTable.id,
        userId: aiAgentsTable.userId,
        roleId: aiAgentsTable.roleId,
        actsAsUserId: aiAgentsTable.actsAsUserId,
        capabilityMask: aiAgentsTable.capabilityMask,
        agentActive: aiAgentsTable.isActive,
        userActive: usersTable.isActive,
      })
      .from(aiAgentsTable)
      .innerJoin(usersTable, eq(usersTable.id, aiAgentsTable.userId))
      .where(eq(aiAgentsTable.tokenHash, tokenHash))
      .limit(1);

    if (row && row.agentActive && row.userActive) {
      let effectiveUserId = row.userId;
      let effectiveRoleId = row.roleId;
      let actsAsOk = true;
      if (row.actsAsUserId != null) {
        // Act-as: the agent runs under the linked user's identity (their full
        // role set, own-scope, audit). If that user is gone/blocked, the key
        // is DENIED rather than silently falling back to the backing account —
        // a fallback would quietly change what data the agent sees.
        const [actsAs] = await db
          .select({ id: usersTable.id, roleId: usersTable.roleId, isActive: usersTable.isActive })
          .from(usersTable)
          .where(eq(usersTable.id, row.actsAsUserId))
          .limit(1);
        if (actsAs && actsAs.isActive) {
          effectiveUserId = actsAs.id;
          effectiveRoleId = actsAs.roleId;
        } else {
          actsAsOk = false;
        }
      }
      if (actsAsOk) {
        payload = { userId: effectiveUserId, roleId: effectiveRoleId, agentId: row.agentId };
        mask = row.capabilityMask as AiAgentMask;
      }
      // Best-effort usage timestamp, at most once per cache window.
      void db
        .update(aiAgentsTable)
        .set({ lastUsedAt: new Date() })
        .where(eq(aiAgentsTable.id, row.agentId))
        .catch(() => {});
    }
  }

  agentCache.set(tokenHash, { payload, mask, ts: now });
  return payload ? { payload, mask } : null;
}

/** Any GET, or the POST records-query read (same read shape as the guest guard). */
function isReadRequest(req: Request): boolean {
  if (req.method === "GET") return true;
  if (req.method === "POST" && /\/records\/query$/.test(req.path)) return true;
  return false;
}

/**
 * Routes an agent key may NEVER touch, regardless of mask or role. These are
 * identity/credential surfaces: without this list an agent could mint itself
 * a stronger key (POST /ai-agents), impersonate a user (ordinary JWT with no
 * mask), set a password on an account, or issue guest links — all defeating
 * the "mask only narrows" guarantee.
 */
function isForbiddenForAgents(req: Request): boolean {
  const p = req.path;
  if (/^\/(ai-agents|modules)(\/|$)/.test(p)) return true;
  if (/^\/auth(\/|$)/.test(p) && req.method !== "GET") return true;
  if (/^\/guest(\/|$)/.test(p)) return true;
  // All user administration (create/update/delete/merge/block/reset-password/
  // guest-links) is credential management. Reads stay available for user fields.
  if (/^\/users(\/|$)/.test(p) && req.method !== "GET") return true;
  return false;
}

/**
 * Hard method-level guard for the agent's capability mask. This NARROWS the
 * role: RBAC still applies on top. Never widens.
 */
export function isAllowedByMask(req: Request, mask: AiAgentMask): boolean {
  if (isForbiddenForAgents(req)) return false;
  if (mask === "full" || mask === "read_edit_create_delete") return true;
  if (isReadRequest(req)) return true;
  if (mask === "read") return false;
  // Endpoints that destroy data through POST must count as "delete".
  if (req.method === "POST" && /\/records\/merge$/.test(req.path)) return false;
  if (req.method === "POST" && /\/purge(-all)?$/.test(req.path)) return false;
  if (req.method === "POST" && /\/records\/bulk$/.test(req.path)) {
    const action = (req.body as { action?: unknown } | undefined)?.action;
    if (action === "delete") return false;
  }
  if (req.method === "PUT" || req.method === "PATCH") return true;
  if (req.method === "POST") return mask === "read_edit_create";
  return false; // DELETE and anything else
}
