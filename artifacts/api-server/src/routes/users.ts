import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import {
  db,
  usersTable,
  rolesTable,
  userRolesTable,
  loginHistoryTable,
  entityFieldsTable,
  appSettingsTable,
  entityRecordsTable,
  pageFieldsTable,
  pageRecordValuesTable,
  auditLogTable,
  deletedFilesTable,
  guestLinksTable,
  entityAutomationsTable,
  aiAgentsTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, invalidateUserAliveCache } from "../middlewares/auth";
import { invalidateAgentCache } from "../lib/aiAgentAuth";
import { requireAdmin, requireSuperAdmin, getPermissions, effectiveRecordPerm, isPrivilegedRole } from "../middlewares/permissions";
import {
  emitEvent,
  EVENT_PAGE_FIELD_SAVED,
  EVENT_RECORD_UPDATED,
  EVENT_USER_CREATED,
} from "../lib/events";
import { USER_REFERENCE_LOCK_NS } from "../lib/user-reference-barrier";
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
  MergeUsersBody,
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
  // Match the FULL role set (primary roleId + additional roles in user_roles),
  // not just the primary role — roles are additive (see multi-role users).
  if (roleId != null) {
    conditions.push(
      sql`(${usersTable.roleId} = ${roleId} OR EXISTS (
        SELECT 1 FROM ${userRolesTable}
        WHERE ${userRolesTable.userId} = ${usersTable.id}
          AND ${userRolesTable.roleId} = ${roleId}
      ))`
    );
  }
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
      .values({ ...rest, lastName: rest.lastName ?? "", roleId: primaryRoleId, language: lang, direction: rest.direction ?? dirForLang(lang), email: email.toLowerCase(), passwordHash })
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
      .values({ ...rest, lastName: rest.lastName ?? "", language: lang, direction: rest.direction ?? dirForLang(lang), roleId, email: email.toLowerCase(), passwordHash })
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

/**
 * Accounts that back an AI agent are managed exclusively through the AI-agents
 * module: editing them here would desynchronize the agent's role, and setting
 * a password would turn a machine key into a login — a privilege escalation.
 */
async function isAgentBackedUser(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: aiAgentsTable.id })
    .from(aiAgentsTable)
    .where(eq(aiAgentsTable.userId, userId))
    .limit(1);
  return Boolean(row);
}

const AGENT_USER_ERROR = "Эта учётная запись принадлежит ИИ-агенту и управляется в модуле «ИИ-агенты»";

router.put("/users/:id", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (await isAgentBackedUser(params.data.id)) {
    res.status(400).json({ error: AGENT_USER_ERROR });
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

  // Role changes may affect an agent's act-as identity (privileged-role check
  // at key resolution); drop the agent cache so it takes effect immediately.
  invalidateAgentCache();

  const user = await getUserWithRole(params.data.id);
  res.json(user);
});

/**
 * Merge duplicate user accounts (superAdmin only). Every stored reference to a
 * source user — user-type field values in entity records and page-local values,
 * audit/history authorship, file-trash authorship, guest-link creator — is
 * repointed to the target, the sources' roles are inherited by the target
 * (deduplicated; the target keeps its own primary role), then the sources are
 * hard-deleted (cascade removes their user_roles and guest links). Runs in one
 * transaction. Guards: cannot merge yourself away, cannot delete a privileged
 * (superAdmin) account as a source.
 */
router.post("/users/merge", requireAuth, requireSuperAdmin(), async (req, res): Promise<void> => {
  const parsed = MergeUsersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { targetUserId } = parsed.data;
  const sourceIds = [...new Set(parsed.data.sourceUserIds)];
  if (sourceIds.includes(targetUserId)) {
    res.status(422).json({ error: "Главная учётная запись не может быть в списке дубликатов" });
    return;
  }
  if (sourceIds.includes(req.user!.userId)) {
    res.status(422).json({ error: "Нельзя объединить собственную учётную запись как дубликат" });
    return;
  }

  const allIds = [targetUserId, ...sourceIds];
  const users = await db.select().from(usersTable).where(inArray(usersTable.id, allIds));
  if (users.length !== allIds.length) {
    res.status(404).json({ error: "Некоторые учётные записи не найдены" });
    return;
  }

  const agentBacked = await db
    .select({ userId: aiAgentsTable.userId })
    .from(aiAgentsTable)
    .where(inArray(aiAgentsTable.userId, allIds));
  if (agentBacked.length > 0) {
    res.status(400).json({ error: AGENT_USER_ERROR });
    return;
  }

  // A privileged (superAdmin) account may be the TARGET but never a deleted
  // source — merging away an admin account by mistake would be unrecoverable.
  const sourceRoleRows = await db
    .select({ roleId: userRolesTable.roleId })
    .from(userRolesTable)
    .where(inArray(userRolesTable.userId, sourceIds));
  const sourceRoleIds = new Set<number>(sourceRoleRows.map((r) => r.roleId));
  for (const u of users) if (u.id !== targetUserId) sourceRoleIds.add(u.roleId);
  const sourceRoles = sourceRoleIds.size
    ? await db.select().from(rolesTable).where(inArray(rolesTable.id, [...sourceRoleIds]))
    : [];
  if (sourceRoles.some((r) => isPrivilegedRole(r.permissionsJson))) {
    res.status(422).json({ error: "Нельзя объединять привилегированные учётные записи как дубликаты" });
    return;
  }

  const sourceIdSet = new Set<number>(sourceIds);
  // Rewrite a stored user-field value: scalar id (number or numeric string) or
  // an array of ids. Arrays are deduplicated after the rewrite. Returns
  // undefined when nothing changed, so callers can skip the row.
  const rewriteValue = (v: unknown): unknown => {
    const mapOne = (x: unknown): unknown => {
      const n = typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x.trim()) ? Number(x.trim()) : null;
      if (n != null && sourceIdSet.has(n)) return typeof x === "string" ? String(targetUserId) : targetUserId;
      return x;
    };
    if (Array.isArray(v)) {
      const mapped = v.map(mapOne);
      if (mapped.every((x, i) => x === v[i])) return undefined;
      const seen = new Set<string>();
      return mapped.filter((x) => {
        const k = String(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    const mapped = mapOne(v);
    return mapped === v ? undefined : mapped;
  };

  let updatedRecordValues = 0;
  let updatedPageValues = 0;
  let mergedRoles = 0;
  const changedRecords = new Map<number, {
    entityId: number; recordId: number; version: number; changedFields: Set<string>;
  }>();
  const changedPageRows = new Map<string, {
    entityId: number; pageId: number; recordId: number; version: number; changedPageFieldKeys: Set<string>;
  }>();

  // SQL prefilter: only rows whose JSON text contains one of the source ids as
  // a standalone number can possibly reference them — avoids loading every
  // record of every entity that merely HAS a user field.
  const idsRegex = `\\m(${sourceIds.join("|")})\\M`;

  await db.transaction(async (tx) => {
    // Exclusive source-user barriers precede candidate discovery and all
    // page/entity locks. Later shared writers fail fast instead of phantoming.
    for (const sourceUserId of [...sourceIds].sort((a, b) => a - b)) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${USER_REFERENCE_LOCK_NS}, ${sourceUserId})`);
    }
    // ---- 1. User-type entity fields: rewrite values_json --------------
    const userFields = await tx
      .select({ entityId: entityFieldsTable.entityId, fieldKey: entityFieldsTable.fieldKey })
      .from(entityFieldsTable)
      .where(and(eq(entityFieldsTable.fieldType, "user"), eq(entityFieldsTable.isActive, true)));
    const keysByEntity = new Map<number, string[]>();
    for (const f of userFields) {
      const arr = keysByEntity.get(f.entityId) ?? [];
      arr.push(f.fieldKey);
      keysByEntity.set(f.entityId, arr);
    }
    const entityCandidates = keysByEntity.size === 0
      ? []
      : await tx
        .select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId })
        .from(entityRecordsTable)
        .where(and(
          inArray(entityRecordsTable.entityId, [...keysByEntity.keys()]),
          sql`${entityRecordsTable.valuesJson}::text ~ ${idsRegex}`,
        )!);

    const pageUserFields = await tx
      .select({ pageId: pageFieldsTable.pageId, fieldKey: pageFieldsTable.fieldKey })
      .from(pageFieldsTable)
      .where(and(eq(pageFieldsTable.fieldType, "user"), eq(pageFieldsTable.isActive, true)));
    const keysByPage = new Map<number, string[]>();
    for (const f of pageUserFields) {
      const arr = keysByPage.get(f.pageId) ?? [];
      arr.push(f.fieldKey);
      keysByPage.set(f.pageId, arr);
    }
    const candidateRows = keysByPage.size === 0
      ? []
      : await tx
        .select({
          id: pageRecordValuesTable.id,
          pageId: pageRecordValuesTable.pageId,
          recordId: pageRecordValuesTable.recordId,
          entityId: entityRecordsTable.entityId,
        })
        .from(pageRecordValuesTable)
        .innerJoin(entityRecordsTable, eq(entityRecordsTable.id, pageRecordValuesTable.recordId))
        .where(and(
          inArray(pageRecordValuesTable.pageId, [...keysByPage.keys()]),
          sql`${pageRecordValuesTable.valuesJson}::text ~ ${idsRegex}`,
        )!);

    // Global merge order: page advisory pairs first, then every affected entity
    // row, then page-value rows. Candidate reads above are discovery only.
    for (const row of [...candidateRows].sort(
      (a, b) => a.pageId - b.pageId || a.recordId - b.recordId,
    )) {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock((${row.pageId}::bigint << 32) | ${row.recordId}::bigint)`,
      );
    }
    const entityLockIds = [...new Set([
      ...entityCandidates.map((row) => row.id),
      ...candidateRows.map((row) => row.recordId),
    ])].sort((a, b) => a - b);
    const lockedEntityRows = entityLockIds.length === 0
      ? []
      : await tx.select().from(entityRecordsTable)
        .where(inArray(entityRecordsTable.id, entityLockIds))
        .orderBy(entityRecordsTable.id)
        .for("update");
    const lockedEntityById = new Map(lockedEntityRows.map((row) => [row.id, row]));

    if (keysByEntity.size > 0) {
      const recs = entityCandidates
        .map((candidate) => lockedEntityById.get(candidate.id))
        .filter((row): row is NonNullable<typeof row> => row != null);
      for (const rec of recs) {
        const keys = keysByEntity.get(rec.entityId)!;
        const values = { ...(rec.valuesJson as Record<string, unknown>) };
        const changedKeys: string[] = [];
        for (const k of keys) {
          if (!(k in values)) continue;
          const next = rewriteValue(values[k]);
          if (next !== undefined) {
            values[k] = next;
            changedKeys.push(k);
          }
        }
        if (changedKeys.length > 0) {
          const [updated] = await tx.update(entityRecordsTable).set({ valuesJson: values })
            .where(eq(entityRecordsTable.id, rec.id))
            .returning({ version: entityRecordsTable.version });
          if (!updated) continue;
          const prior = changedRecords.get(rec.id);
          changedRecords.set(rec.id, {
            entityId: rec.entityId,
            recordId: rec.id,
            version: updated.version,
            changedFields: new Set([...(prior?.changedFields ?? []), ...changedKeys]),
          });
          updatedRecordValues += 1;
        }
      }
    }

    // ---- 2. User-type page-local fields: rewrite page values ----------
    if (keysByPage.size > 0) {
      const candidateById = new Map(candidateRows.map((row) => [row.id, row]));
      const rows = candidateRows.length === 0
        ? []
        : await tx
          .select({
            id: pageRecordValuesTable.id,
            pageId: pageRecordValuesTable.pageId,
            recordId: pageRecordValuesTable.recordId,
            valuesJson: pageRecordValuesTable.valuesJson,
          })
          .from(pageRecordValuesTable)
          .where(inArray(pageRecordValuesTable.id, candidateRows.map((row) => row.id)))
          .orderBy(pageRecordValuesTable.pageId, pageRecordValuesTable.recordId)
          .for("update");
      for (const row of rows) {
        const keys = keysByPage.get(row.pageId)!;
        const values = { ...(row.valuesJson as Record<string, unknown>) };
        const changedKeys: string[] = [];
        for (const k of keys) {
          if (!(k in values)) continue;
          const next = rewriteValue(values[k]);
          if (next !== undefined) {
            values[k] = next;
            changedKeys.push(k);
          }
        }
        if (changedKeys.length > 0) {
          const [updated] = await tx.update(pageRecordValuesTable).set({ valuesJson: values })
            .where(eq(pageRecordValuesTable.id, row.id))
            .returning({ version: pageRecordValuesTable.version });
          if (!updated) continue;
          const eventKey = `${row.pageId}:${row.recordId}`;
          const prior = changedPageRows.get(eventKey);
          changedPageRows.set(eventKey, {
            entityId: candidateById.get(row.id)!.entityId,
            pageId: row.pageId,
            recordId: row.recordId,
            version: updated.version,
            changedPageFieldKeys: new Set([...(prior?.changedPageFieldKeys ?? []), ...changedKeys]),
          });
          updatedPageValues += 1;
        }
      }
    }

    // ---- 2b. Automation configs: rewrite literal user ids -------------
    // Automation conditions/actions may store user ids as literal `value`s
    // next to a `fieldKey` that is a user-type field (of the automation's own
    // entity or of an action's target entity). Walk the JSON and rewrite any
    // `value` whose sibling `fieldKey` is a known user-field key. Keyed on the
    // GLOBAL user-field key set: a fieldKey shared with a non-user field in
    // another entity is theoretically over-matched, but only when its literal
    // value exactly equals a deleted duplicate's id — acceptable for a
    // superAdmin-only maintenance operation.
    const globalUserFieldKeys = new Set(userFields.map((f) => f.fieldKey));
    for (const f of pageUserFields) globalUserFieldKeys.add(f.fieldKey);
    const rewriteAutomationNode = (node: unknown): boolean => {
      let changed = false;
      if (Array.isArray(node)) {
        for (const item of node) changed = rewriteAutomationNode(item) || changed;
        return changed;
      }
      if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (typeof obj.fieldKey === "string" && globalUserFieldKeys.has(obj.fieldKey) && "value" in obj) {
          const next = rewriteValue(obj.value);
          if (next !== undefined) {
            obj.value = next;
            changed = true;
          }
        }
        for (const k of Object.keys(obj)) {
          if (k !== "value") changed = rewriteAutomationNode(obj[k]) || changed;
        }
      }
      return changed;
    };
    if (globalUserFieldKeys.size > 0) {
      const automations = await tx
        .select({ id: entityAutomationsTable.id, conditionsJson: entityAutomationsTable.conditionsJson, actionsJson: entityAutomationsTable.actionsJson })
        .from(entityAutomationsTable)
        .where(sql`(${entityAutomationsTable.conditionsJson}::text ~ ${idsRegex} OR ${entityAutomationsTable.actionsJson}::text ~ ${idsRegex})`);
      for (const a of automations) {
        const conditions = JSON.parse(JSON.stringify(a.conditionsJson ?? []));
        const actions = JSON.parse(JSON.stringify(a.actionsJson ?? []));
        const changed = [rewriteAutomationNode(conditions), rewriteAutomationNode(actions)].some(Boolean);
        if (changed) {
          await tx
            .update(entityAutomationsTable)
            .set({ conditionsJson: conditions, actionsJson: actions })
            .where(eq(entityAutomationsTable.id, a.id));
        }
      }
    }

    // ---- 3. Plain authorship columns (no FK) ---------------------------
    await tx.update(auditLogTable).set({ userId: targetUserId }).where(inArray(auditLogTable.userId, sourceIds));
    await tx.update(loginHistoryTable).set({ userId: targetUserId }).where(inArray(loginHistoryTable.userId, sourceIds));
    await tx.update(deletedFilesTable).set({ deletedBy: targetUserId }).where(inArray(deletedFilesTable.deletedBy, sourceIds));
    await tx.update(guestLinksTable).set({ createdBy: targetUserId }).where(inArray(guestLinksTable.createdBy, sourceIds));

    // ---- 4. Roles: target inherits the sources' roles (additive) ------
    const target = users.find((u) => u.id === targetUserId)!;
    const targetRoleRows = await tx
      .select({ roleId: userRolesTable.roleId })
      .from(userRolesTable)
      .where(eq(userRolesTable.userId, targetUserId));
    const targetRoleIds = new Set<number>([target.roleId, ...targetRoleRows.map((r) => r.roleId)]);
    for (const roleId of sourceRoleIds) {
      if (targetRoleIds.has(roleId)) continue;
      await tx.insert(userRolesTable).values({ userId: targetUserId, roleId }).onConflictDoNothing();
      mergedRoles += 1;
    }

    // ---- 5. Delete the duplicates (cascade: user_roles, guest_links) --
    await tx.delete(usersTable).where(inArray(usersTable.id, sourceIds));
  });

  await emitEvent([
    ...[...changedRecords.values()].map((changed) => ({
      eventName: EVENT_RECORD_UPDATED,
      entityId: changed.entityId,
      recordId: changed.recordId,
      payload: {
        actorUserId: req.user!.userId,
        changedFields: [...changed.changedFields],
        version: changed.version,
      },
    })),
    ...[...changedPageRows.values()].map((changed) => ({
      eventName: EVENT_PAGE_FIELD_SAVED,
      entityId: changed.entityId,
      recordId: changed.recordId,
      payload: {
        actorUserId: req.user!.userId,
        pageId: changed.pageId,
        changedPageFieldKeys: [...changed.changedPageFieldKeys],
        version: changed.version,
      },
    })),
  ], req.log);

  // Any still-valid JWTs of the deleted accounts die at the auth layer: drop
  // their cached "alive" verdicts so the next request re-checks the DB.
  for (const id of sourceIds) invalidateUserAliveCache(id);
  invalidateAgentCache();

  req.log.info(
    { targetUserId, sourceIds, updatedRecordValues, updatedPageValues, mergedRoles },
    "users merged",
  );
  res.json({ updatedRecordValues, updatedPageValues, mergedRoles, deletedUserIds: sourceIds });
});

router.delete("/users/:id", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (await isAgentBackedUser(params.data.id)) {
    res.status(400).json({ error: AGENT_USER_ERROR });
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

  invalidateUserAliveCache(deleted.id);
  invalidateAgentCache();
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

  invalidateUserAliveCache(params.data.id);
  invalidateAgentCache();

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

  invalidateUserAliveCache(params.data.id);
  invalidateAgentCache();

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

  if (await isAgentBackedUser(params.data.id)) {
    res.status(400).json({ error: AGENT_USER_ERROR });
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
