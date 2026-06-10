import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, rolesTable, userRolesTable, loginHistoryTable, entityFieldsTable, appSettingsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, getPermissions, effectiveRecordPerm, isPrivilegedRole } from "../middlewares/permissions";
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
  CreateUserFromFieldParams,
  CreateUserFromFieldBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: unknown): number {
  const id = parseInt(String(raw), 10);
  return id;
}

function dirForLang(lang: string): "ltr" | "rtl" {
  return lang === "he" ? "rtl" : "ltr";
}

/**
 * Platform default UI language (from the singleton app_settings row). New users
 * inherit it so the admin-configured default actually takes effect for accounts
 * that haven't picked their own language yet.
 */
async function getDefaultLang(): Promise<string> {
  const [row] = await db
    .select({ defaultLanguage: appSettingsTable.defaultLanguage })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1));
  return row?.defaultLanguage ?? "ru";
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

  const { password, email, roleIds, roleId, ...rest } = parsed.data;
  // A null/omitted password creates a passwordless guest user: they can never log
  // in with a password, only via a guest link (which issues a read-only token).
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  // The primary role is roleIds[0] (falling back to the deprecated roleId alias).
  const primaryRoleId = roleIds && roleIds.length > 0 ? roleIds[0] : roleId;
  if (primaryRoleId == null) {
    res.status(400).json({ error: "At least one role is required" });
    return;
  }
  const roleSet = await resolveRoleSet(primaryRoleId, roleIds ?? undefined);
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

  const defaultLang = await getDefaultLang();
  const lang = rest.language ?? defaultLang;
  const user = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(usersTable)
      .values({ ...rest, roleId: primaryRoleId, language: lang, direction: rest.direction ?? dirForLang(lang), email: email.toLowerCase(), passwordHash })
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

/**
 * Inline "create user from a user-type field". Unlike POST /users this is open to
 * plain record EDITORS (no `users` admin cap), so it carries its own hard
 * boundaries to avoid privilege escalation:
 *  - the field must be a user-type field that opts in (`allowCreate`);
 *  - the caller must have create/update rights on the field's entity;
 *  - the target role must be within the field's `allowedRoleIds` (server-enforced,
 *    not just the cosmetic UI list);
 *  - the target role must NOT be privileged (no superAdmin / admin caps) — even a
 *    misconfigured field cannot mint an administrator. Real admin creation always
 *    goes through POST /users.
 */
router.post("/fields/:fieldId/users", requireAuth, async (req, res): Promise<void> => {
  const paramsParsed = CreateUserFromFieldParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.message });
    return;
  }
  const bodyParsed = CreateUserFromFieldBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  const { fieldId } = paramsParsed.data;
  const { roleId, password, email, pageId, ...rest } = bodyParsed.data;

  const [field] = await db
    .select({
      entityId: entityFieldsTable.entityId,
      fieldType: entityFieldsTable.fieldType,
      userConfig: entityFieldsTable.userConfigJson,
    })
    .from(entityFieldsTable)
    .where(eq(entityFieldsTable.id, fieldId));
  if (!field) {
    res.status(404).json({ error: "Field not found" });
    return;
  }
  if (field.fieldType !== "user" || field.userConfig?.allowCreate !== true) {
    res.status(403).json({ error: "Inline user creation is not enabled for this field" });
    return;
  }

  // Authorize on record-edit rights for the field's entity — NOT the users cap.
  const perms = await getPermissions(req);
  if (!perms.superAdmin) {
    const rp = await effectiveRecordPerm(req, perms, field.entityId, pageId);
    if (rp?.create !== true && rp?.update !== true) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  // Server-enforced field role whitelist (the UI dropdown is only cosmetic).
  const allowed = field.userConfig?.allowedRoleIds ?? [];
  if (allowed.length > 0 && !allowed.includes(roleId)) {
    res.status(403).json({ error: "Role is not allowed for this field" });
    return;
  }

  const [role] = await db
    .select({ permissions: rolesTable.permissionsJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, roleId));
  if (!role) {
    res.status(400).json({ error: "Role does not exist" });
    return;
  }
  // Hard anti-escalation boundary: this path can never create a privileged user.
  if (isPrivilegedRole(role.permissions)) {
    res.status(403).json({ error: "Cannot assign a privileged role through a field" });
    return;
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));
  if (existing) {
    res.status(400).json({ error: "Email already in use" });
    return;
  }

  const defaultLang = await getDefaultLang();
  const lang = rest.language ?? defaultLang;
  const user = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(usersTable)
      .values({ ...rest, language: lang, direction: rest.direction ?? dirForLang(lang), roleId, email: email.toLowerCase(), passwordHash })
      .returning({ id: usersTable.id, roleId: usersTable.roleId });
    await tx.insert(userRolesTable).values({ userId: created.id, roleId });
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
  // A user can hold additional roles beyond their primary one. Resolve the full
  // role set per user so `user`-field role restrictions match on ANY of the
  // user's roles, not just the primary role (otherwise a manager added as a
  // secondary role would be invisible in the picker).
  const userIds = rows.map((u) => u.id);
  const rolesByUser = new Map<number, number[]>();
  if (userIds.length > 0) {
    const extraRoles = await db
      .select({ userId: userRolesTable.userId, roleId: userRolesTable.roleId })
      .from(userRolesTable)
      .where(inArray(userRolesTable.userId, userIds));
    for (const r of extraRoles) {
      const arr = rolesByUser.get(r.userId) ?? [];
      arr.push(r.roleId);
      rolesByUser.set(r.userId, arr);
    }
  }
  const options = rows.map((u) => {
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
    return {
      id: u.id,
      name: name || u.email,
      roleId: u.roleId,
      roleIds: [...new Set([u.roleId, ...(rolesByUser.get(u.id) ?? [])])],
    };
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
  if (body.language != null) updateData.language = body.language;
  if (body.direction != null) updateData.direction = body.direction;
  if ("startPageId" in body) updateData.startPageId = body.startPageId;

  const rolesProvided = body.roleIds != null && body.roleIds.length > 0;
  const primaryProvided = rolesProvided || body.roleId != null;

  if (Object.keys(updateData).length === 0 && !primaryProvided) {
    const user = await getUserWithRole(params.data.id);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(user);
    return;
  }

  // Load the existing user so we can resolve the effective primary role when the
  // request changes roleIds without changing the primary (or vice versa).
  const [current] = await db
    .select({ id: usersTable.id, roleId: usersTable.roleId })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Primary role is roleIds[0] when provided, else the deprecated roleId alias,
  // else the user's existing primary.
  const newPrimary = rolesProvided ? body.roleIds![0] : (body.roleId ?? current.roleId);
  if (primaryProvided) updateData.roleId = newPrimary;
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
