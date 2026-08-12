import { Router, type IRouter } from "express";
import { db, aiAgentsTable, usersTable, rolesTable, modulesTable, AI_AGENT_MASKS, type AiAgentMask } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAuth, invalidateUserAliveCache } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
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
