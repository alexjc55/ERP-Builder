import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, rolesTable, userRolesTable, loginHistoryTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/permissions";
import { emitEvent, EVENT_USER_CREATED } from "../lib/events";
import {
  CreateUserBody,
  UpdateUserBody,
  GetUserParams,
  UpdateUserParams,
  DeleteUserParams,
  BlockUserParams,
  UnblockUserParams,
  ResetUserPasswordParams,
  ResetUserPasswordBody,
  ListUserLoginHistoryParams,
  ListUsersQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: unknown): number {
  const id = parseInt(String(raw), 10);
  return id;
}

async function getUserWithRole(id: number) {
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      roleId: usersTable.roleId,
      language: usersTable.language,
      direction: usersTable.direction,
      startPageId: usersTable.startPageId,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, id));

  if (!user) return null;

  const [role] = await db
    .select({ nameJson: rolesTable.nameJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, user.roleId));

  const roleRows = await db
    .select({ roleId: userRolesTable.roleId })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, id));
  // The primary role is always part of the effective set, even if a legacy user
  // somehow has no user_roles rows yet.
  const roleIds = [...new Set([user.roleId, ...roleRows.map((r) => r.roleId)])];

  return { ...user, roleName: role?.nameJson ?? {}, roleIds };
}

/**
 * Resolve the full, validated role set for a write. The primary `roleId` is
 * always included. Returns null when any provided role id does not exist.
 */
async function resolveRoleSet(primaryRoleId: number, roleIds?: number[]): Promise<number[] | null> {
  const set = [...new Set([primaryRoleId, ...(roleIds ?? [])])];
  const existing = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(inArray(rolesTable.id, set));
  if (existing.length !== set.length) return null;
  return set;
}

router.get("/users", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const parsed = ListUsersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { search, roleId, isActive, limit = 50, offset = 0 } = parsed.data;

  const conditions = [];
  if (search) {
    conditions.push(
      sql`(${usersTable.email} ILIKE ${"%" + search + "%"} OR ${usersTable.firstName} ILIKE ${"%" + search + "%"} OR ${usersTable.lastName} ILIKE ${"%" + search + "%"})`
    );
  }
  if (roleId != null) conditions.push(eq(usersTable.roleId, roleId));
  if (isActive != null) conditions.push(eq(usersTable.isActive, isActive));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [users, countResult] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        roleId: usersTable.roleId,
        language: usersTable.language,
        direction: usersTable.direction,
        startPageId: usersTable.startPageId,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
      })
      .from(usersTable)
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(usersTable.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(where),
  ]);

  const primaryRoleIds = [...new Set(users.map((u) => u.roleId))];
  let roleMap: Record<number, unknown> = {};
  if (primaryRoleIds.length > 0) {
    const roles = await db
      .select({ id: rolesTable.id, nameJson: rolesTable.nameJson })
      .from(rolesTable);
    roleMap = Object.fromEntries(roles.map((r) => [r.id, r.nameJson]));
  }

  // Batch-load the full role set per user so the list mirrors the detail view.
  const userIds = users.map((u) => u.id);
  const rolesByUser = new Map<number, number[]>();
  if (userIds.length > 0) {
    const rows = await db
      .select({ userId: userRolesTable.userId, roleId: userRolesTable.roleId })
      .from(userRolesTable)
      .where(inArray(userRolesTable.userId, userIds));
    for (const r of rows) {
      const arr = rolesByUser.get(r.userId) ?? [];
      arr.push(r.roleId);
      rolesByUser.set(r.userId, arr);
    }
  }

  const data = users.map((u) => ({
    ...u,
    roleName: roleMap[u.roleId] ?? {},
    roleIds: [...new Set([u.roleId, ...(rolesByUser.get(u.id) ?? [])])],
  }));

  res.json({ data, total: countResult[0]?.count ?? 0 });
});

router.post("/users", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { password, email, roleIds, ...rest } = parsed.data;
  // A null/omitted password creates a passwordless guest user: they can never log
  // in with a password, only via a guest link (which issues a read-only token).
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  // The primary role (rest.roleId) is always part of the effective set.
  const roleSet = await resolveRoleSet(rest.roleId, roleIds ?? undefined);
  if (!roleSet) {
    res.status(400).json({ error: "One or more roles do not exist" });
    return;
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));

  if (existing) {
    res.status(400).json({ error: "Email already in use" });
    return;
  }

  const user = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(usersTable)
      .values({ ...rest, email: email.toLowerCase(), passwordHash })
      .returning({ id: usersTable.id, roleId: usersTable.roleId });
    await tx.insert(userRolesTable).values(roleSet.map((rid) => ({ userId: created.id, roleId: rid })));
    return created;
  });

  await emitEvent(
    {
      eventName: EVENT_USER_CREATED,
      recordId: user.id,
      payload: { actorUserId: req.user!.userId, userId: user.id, roleId: user.roleId },
    },
    req.log,
  );

  const result = await getUserWithRole(user.id);
  res.status(201).json(result);
});

router.get("/users/options", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      roleId: usersTable.roleId,
    })
    .from(usersTable)
    .orderBy(usersTable.firstName, usersTable.lastName);
  const options = rows.map((u) => {
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return { id: u.id, name: name || u.email, roleId: u.roleId };
  });
  res.json(options);
});

router.get("/users/:id", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const user = await getUserWithRole(params.data.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(user);
});

router.put("/users/:id", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  const body = parsed.data;
  if (body.email != null) updateData.email = body.email.toLowerCase();
  if (body.firstName != null) updateData.firstName = body.firstName;
  if (body.lastName != null) updateData.lastName = body.lastName;
  if (body.roleId != null) updateData.roleId = body.roleId;
  if (body.language != null) updateData.language = body.language;
  if (body.direction != null) updateData.direction = body.direction;
  if ("startPageId" in body) updateData.startPageId = body.startPageId;

  const rolesProvided = body.roleIds != null;

  if (Object.keys(updateData).length === 0 && !rolesProvided) {
    const user = await getUserWithRole(params.data.id);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(user);
    return;
  }

  // Load the existing user so we can resolve the effective primary role when the
  // request changes roleIds without changing roleId (or vice versa).
  const [current] = await db
    .select({ id: usersTable.id, roleId: usersTable.roleId })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const newPrimary = body.roleId ?? current.roleId;
  // The primary role is always part of the effective set.
  const roleSet = rolesProvided
    ? await resolveRoleSet(newPrimary, body.roleIds ?? undefined)
    : null;
  if (rolesProvided && !roleSet) {
    res.status(400).json({ error: "One or more roles do not exist" });
    return;
  }

  await db.transaction(async (tx) => {
    if (Object.keys(updateData).length > 0) {
      await tx.update(usersTable).set(updateData).where(eq(usersTable.id, params.data.id));
    }
    if (roleSet) {
      // Replace the full role set with the requested one.
      await tx.delete(userRolesTable).where(eq(userRolesTable.userId, params.data.id));
      await tx.insert(userRolesTable).values(roleSet.map((rid) => ({ userId: params.data.id, roleId: rid })));
    } else if (body.roleId != null) {
      // Changing only the primary role: ensure it is present in the role set
      // without disturbing the other assigned roles.
      await tx
        .insert(userRolesTable)
        .values({ userId: params.data.id, roleId: body.roleId })
        .onConflictDoNothing();
    }
  });

  const user = await getUserWithRole(params.data.id);
  res.json(user);
});

router.delete("/users/:id", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, params.data.id))
    .returning({ id: usersTable.id });

  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ success: true, message: "User deleted" });
});

router.post("/users/:id/block", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = BlockUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db
    .update(usersTable)
    .set({ isActive: false })
    .where(eq(usersTable.id, params.data.id));

  const user = await getUserWithRole(params.data.id);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(user);
});

router.post("/users/:id/unblock", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = UnblockUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db
    .update(usersTable)
    .set({ isActive: true })
    .where(eq(usersTable.id, params.data.id));

  const user = await getUserWithRole(params.data.id);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(user);
});

router.post("/users/:id/reset-password", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = ResetUserPasswordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = ResetUserPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db
    .update(usersTable)
    .set({ passwordHash: newHash })
    .where(eq(usersTable.id, params.data.id));

  res.json({ success: true, message: "Password reset" });
});

router.get("/users/:id/login-history", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = ListUserLoginHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const history = await db
    .select()
    .from(loginHistoryTable)
    .where(eq(loginHistoryTable.userId, params.data.id))
    .orderBy(desc(loginHistoryTable.createdAt))
    .limit(20);

  res.json(history);
});

export default router;
