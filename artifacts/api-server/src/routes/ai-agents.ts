import { Router, type IRouter } from "express";
import { db, aiAgentsTable, usersTable, rolesTable, userRolesTable, modulesTable, AI_AGENT_MASKS, type AiAgentMask, type RolePermissions } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAuth, invalidateUserAliveCache } from "../middlewares/auth";
import { requireAdmin, isPrivilegedRole } from "../middlewares/permissions";
import { generateAgentKey, invalidateAgentCache, AI_AGENTS_MODULE_KEY } from "../lib/aiAgentAuth";
import {
  CreateAiAgentBody,
  UpdateAiAgentBody,
  UpdateAiAgentParams,
  DeleteAiAgentParams,
  RegenerateAiAgentKeyParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * AI Agents module (Variant A): machine keys for EXTERNAL LLM agents (e.g. a
 * ChatGPT custom GPT with Actions) that call the ERP API directly. Each agent
 * is backed by a passwordless user account so the entire RBAC boundary
 * (hidden fields/statuses, own scope, page perms, audit attribution) applies
 * through the standard pipeline; the capability mask narrows it further at
 * the HTTP-method level in requireAuth.
 *
 * Management is gated by the `modules` admin capability, same as the module
 * registry itself.
 */

async function roleExists(roleId: number): Promise<boolean> {
  const [row] = await db.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.id, roleId)).limit(1);
  return Boolean(row);
}

/**
 * Validate an "act as user" link. The linked user must be a real, active,
 * human account whose FULL role set (primary + additional) contains no
 * privileged role — otherwise a modules-cap admin could mint себе a key that
 * acts as a superAdmin/admin (privilege escalation), or chain agents.
 * Returns an error message or null when valid.
 */
async function validateActsAsUser(userId: number): Promise<string | null> {
  const [user] = await db
    .select({ id: usersTable.id, roleId: usersTable.roleId, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user || !user.isActive) return "Пользователь не найден или заблокирован";
  const [agentBacked] = await db
    .select({ id: aiAgentsTable.id })
    .from(aiAgentsTable)
    .where(eq(aiAgentsTable.userId, userId))
    .limit(1);
  if (agentBacked) return "Нельзя выбрать учётную запись другого ИИ-агента";
  const extraRoles = await db
    .select({ roleId: userRolesTable.roleId })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));
  const roleIds = [...new Set([user.roleId, ...extraRoles.map((r) => r.roleId)])];
  const roles = await db
    .select({ permissionsJson: rolesTable.permissionsJson })
    .from(rolesTable)
    .where(inArray(rolesTable.id, roleIds));
  if (roles.some((r) => isPrivilegedRole(r.permissionsJson as RolePermissions))) {
    return "Нельзя работать от лица администратора";
  }
  return null;
}

/**
 * Users eligible for the "act as" link of an agent with the given role:
 * active, human (not agent-backed), non-privileged, and having roleId in
 * their FULL role set (primary or additional).
 */
router.get("/ai-agents/acts-as-candidates", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const roleId = Number(req.query.roleId);
  if (!Number.isInteger(roleId) || roleId <= 0) {
    res.status(400).json({ error: "roleId is required" });
    return;
  }
  const viaExtra = db
    .select({ userId: userRolesTable.userId })
    .from(userRolesTable)
    .where(eq(userRolesTable.roleId, roleId));
  const users = await db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email, roleId: usersTable.roleId })
    .from(usersTable)
    .where(and(eq(usersTable.isActive, true)))
    .orderBy(usersTable.firstName);
  const extraSet = new Set((await viaExtra).map((r) => r.userId));
  const agentUserIds = new Set((await db.select({ userId: aiAgentsTable.userId }).from(aiAgentsTable)).map((r) => r.userId));
  // Privileged roles (superAdmin / any admin cap) disqualify a user entirely.
  const allRoles = await db.select({ id: rolesTable.id, permissionsJson: rolesTable.permissionsJson }).from(rolesTable);
  const privilegedRoleIds = new Set(allRoles.filter((r) => isPrivilegedRole(r.permissionsJson as RolePermissions)).map((r) => r.id));
  const allUserRoles = await db.select({ userId: userRolesTable.userId, roleId: userRolesTable.roleId }).from(userRolesTable);
  const privilegedUserIds = new Set(allUserRoles.filter((r) => privilegedRoleIds.has(r.roleId)).map((r) => r.userId));
  const candidates = users
    .filter((u) =>
      !agentUserIds.has(u.id) &&
      (u.roleId === roleId || extraSet.has(u.id)) &&
      !privilegedRoleIds.has(u.roleId) &&
      !privilegedUserIds.has(u.id),
    )
    .map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }));
  res.json(candidates);
});

router.get("/ai-agents", requireAuth, requireAdmin("modules"), async (_req, res): Promise<void> => {
  const agents = await db.select().from(aiAgentsTable).orderBy(aiAgentsTable.createdAt);
  res.json(agents);
});

router.post("/ai-agents", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const parsed = CreateAiAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const mask = (parsed.data.capabilityMask ?? "read") as AiAgentMask;
  if (!AI_AGENT_MASKS.includes(mask)) {
    res.status(400).json({ error: "Invalid capability mask" });
    return;
  }
  if (!(await roleExists(parsed.data.roleId))) {
    res.status(400).json({ error: "Role not found" });
    return;
  }
  const actsAsUserId = parsed.data.actsAsUserId ?? null;
  if (actsAsUserId != null) {
    const err = await validateActsAsUser(actsAsUserId);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
  }

  const key = generateAgentKey();
  const agent = await db.transaction(async (tx) => {
    // Backing passwordless account: cannot log in (no password hash), carries
    // the role for RBAC and shows up as the author in audit/ownership.
    const [user] = await tx
      .insert(usersTable)
      .values({
        email: `ai-agent-${randomBytes(6).toString("hex")}@agents.local`,
        passwordHash: null,
        firstName: name,
        lastName: "(ИИ-агент)",
        roleId: parsed.data.roleId,
      })
      .returning({ id: usersTable.id });
    if (!user) throw new Error("Failed to create backing account");
    const [created] = await tx
      .insert(aiAgentsTable)
      .values({
        name,
        userId: user.id,
        roleId: parsed.data.roleId,
        capabilityMask: mask,
        actsAsUserId,
        tokenHash: key.tokenHash,
        tokenPrefix: key.tokenPrefix,
      })
      .returning();
    return created;
  });

  res.status(201).json({ ...agent, plainKey: key.plainKey });
});

router.put("/ai-agents/:id", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const params = UpdateAiAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAiAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(aiAgentsTable).where(eq(aiAgentsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name != null) {
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    updateData.name = name;
  }
  if (parsed.data.roleId != null) {
    if (!(await roleExists(parsed.data.roleId))) {
      res.status(400).json({ error: "Role not found" });
      return;
    }
    updateData.roleId = parsed.data.roleId;
  }
  if (parsed.data.capabilityMask != null) {
    if (!AI_AGENT_MASKS.includes(parsed.data.capabilityMask as AiAgentMask)) {
      res.status(400).json({ error: "Invalid capability mask" });
      return;
    }
    updateData.capabilityMask = parsed.data.capabilityMask;
  }
  if (parsed.data.isActive != null) updateData.isActive = parsed.data.isActive;
  if ("actsAsUserId" in parsed.data) {
    const actsAsUserId = parsed.data.actsAsUserId ?? null;
    if (actsAsUserId != null) {
      const err = await validateActsAsUser(actsAsUserId);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }
    updateData.actsAsUserId = actsAsUserId;
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [agent] = await db.transaction(async (tx) => {
    const updated = await tx.update(aiAgentsTable).set(updateData).where(eq(aiAgentsTable.id, params.data.id)).returning();
    // Keep the backing account in lockstep so RBAC/own-scope follow the agent.
    const userSync: Record<string, unknown> = {};
    if (updateData.roleId != null) userSync.roleId = updateData.roleId;
    if (updateData.name != null) userSync.firstName = updateData.name;
    if (updateData.isActive != null) userSync.isActive = updateData.isActive;
    if (Object.keys(userSync).length > 0) {
      await tx.update(usersTable).set(userSync).where(eq(usersTable.id, existing.userId));
    }
    return updated;
  });

  invalidateAgentCache();
  invalidateUserAliveCache(existing.userId);
  res.json(agent);
});

router.delete("/ai-agents/:id", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const params = DeleteAiAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db.select().from(aiAgentsTable).where(eq(aiAgentsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(aiAgentsTable).where(eq(aiAgentsTable.id, params.data.id));
    // The backing account is deactivated (not deleted) so audit history and
    // record authorship keep a valid author reference.
    await tx.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, existing.userId));
  });

  invalidateAgentCache();
  invalidateUserAliveCache(existing.userId);
  res.json({ success: true, message: "Agent deleted" });
});

router.post("/ai-agents/:id/regenerate-key", requireAuth, requireAdmin("modules"), async (req, res): Promise<void> => {
  const params = RegenerateAiAgentKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const key = generateAgentKey();
  const [agent] = await db
    .update(aiAgentsTable)
    .set({ tokenHash: key.tokenHash, tokenPrefix: key.tokenPrefix })
    .where(eq(aiAgentsTable.id, params.data.id))
    .returning();

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  invalidateAgentCache();
  res.json({ ...agent, plainKey: key.plainKey });
});

/** Insert the system module row once so it appears in the Модули registry. */
export async function ensureAiAgentsModule(): Promise<void> {
  await db
    .insert(modulesTable)
    .values({
      moduleKey: AI_AGENTS_MODULE_KEY,
      nameJson: { ru: "ИИ-агенты", en: "AI Agents", he: "סוכני AI" },
      version: "1.0.0",
      isEnabled: false,
    })
    .onConflictDoNothing({ target: modulesTable.moduleKey });
}

export default router;
