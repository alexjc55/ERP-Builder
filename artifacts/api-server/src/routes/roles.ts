import { Router, type IRouter } from "express";
import { db, rolesTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import {
  CreateRoleBody,
  UpdateRoleBody,
  GetRoleParams,
  UpdateRoleParams,
  DeleteRoleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/roles", requireAuth, async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.createdAt);

  // Count users per role
  const counts = await db
    .select({
      roleId: usersTable.roleId,
      count: sql<number>`count(*)::int`,
    })
    .from(usersTable)
    .groupBy(usersTable.roleId);

  const countMap = Object.fromEntries(counts.map((c) => [c.roleId, c.count]));

  res.json(roles.map((r) => ({ ...r, userCount: countMap[r.id] ?? 0 })));
});

router.post("/roles", requireAuth, requireAdmin("roles"), async (req, res): Promise<void> => {
  const parsed = CreateRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [role] = await db.insert(rolesTable).values(parsed.data).returning();
  res.status(201).json({ ...role, userCount: 0 });
});

router.get("/roles/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetRoleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [role] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.id, params.data.id));

  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }

  const [count] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(eq(usersTable.roleId, params.data.id));

  res.json({ ...role, userCount: count?.count ?? 0 });
});

router.put("/roles/:id", requireAuth, requireAdmin("roles"), async (req, res): Promise<void> => {
  const params = UpdateRoleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.nameJson != null) updateData.nameJson = parsed.data.nameJson;
  if (parsed.data.descriptionJson != null) updateData.descriptionJson = parsed.data.descriptionJson;
  if (parsed.data.permissionsJson != null) updateData.permissionsJson = parsed.data.permissionsJson;

  const [role] = await db
    .update(rolesTable)
    .set(updateData)
    .where(eq(rolesTable.id, params.data.id))
    .returning();

  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }

  const [count] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(eq(usersTable.roleId, params.data.id));

  res.json({ ...role, userCount: count?.count ?? 0 });
});

router.delete("/roles/:id", requireAuth, requireAdmin("roles"), async (req, res): Promise<void> => {
  const params = DeleteRoleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(rolesTable)
    .where(eq(rolesTable.id, params.data.id))
    .returning({ id: rolesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Role not found" });
    return;
  }

  res.json({ success: true, message: "Role deleted" });
});

export default router;
