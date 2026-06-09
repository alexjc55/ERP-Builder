import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, rolesTable, loginHistoryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/jwt";
import { requireAuth } from "../middlewares/auth";
import { loadRoleContext, getPermissions } from "../middlewares/permissions";
import {
  LoginBody,
  ChangePasswordBody,
  UpdateMeBody,
  ImpersonateBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

/** Resolve the original admin behind an impersonation token, for display. */
async function resolveImpersonator(
  impersonatorId: number | undefined,
): Promise<{ id: number; name: string } | null> {
  if (!impersonatorId) return null;
  const [u] = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(eq(usersTable.id, impersonatorId));
  if (!u) return null;
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
  return { id: u.id, name };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      passwordHash: usersTable.passwordHash,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      roleId: usersTable.roleId,
      language: usersTable.language,
      direction: usersTable.direction,
      startPageId: usersTable.startPageId,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));

  if (!user || !user.isActive || !user.passwordHash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Log login
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "";
  await db.insert(loginHistoryTable).values({
    userId: user.id,
    ipAddress: ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  const token = signToken({ userId: user.id, roleId: user.roleId });

  // Get role name
  const [role] = await db
    .select({ nameJson: rolesTable.nameJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, user.roleId));

  const { roleIds, permissions } = await loadRoleContext(user.id, user.roleId);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      roleIds,
      roleName: role?.nameJson ?? {},
      language: user.language,
      direction: user.direction,
      startPageId: user.startPageId,
      isActive: user.isActive,
      permissions,
    },
  });
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ success: true, message: "Logged out" });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
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
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const [role] = await db
    .select({ nameJson: rolesTable.nameJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, user.roleId));

  const { roleIds, permissions } = await loadRoleContext(user.id, user.roleId);
  const impersonator = await resolveImpersonator(req.user!.impersonatorId);

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    roleIds,
    roleName: role?.nameJson ?? {},
    language: user.language,
    direction: user.direction,
    startPageId: user.startPageId,
    isActive: user.isActive,
    permissions,
    isGuest: req.user!.guest ?? false,
    impersonator,
  });
});

router.put("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.firstName !== undefined) updates.firstName = parsed.data.firstName;
  if (parsed.data.lastName !== undefined) updates.lastName = parsed.data.lastName;
  if (parsed.data.language !== undefined) updates.language = parsed.data.language;
  if (parsed.data.direction !== undefined) updates.direction = parsed.data.direction;
  if (parsed.data.startPageId !== undefined) updates.startPageId = parsed.data.startPageId;

  if (Object.keys(updates).length > 0) {
    await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, req.user!.userId));
  }

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
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const [role] = await db
    .select({ nameJson: rolesTable.nameJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, user.roleId));

  const { roleIds, permissions } = await loadRoleContext(user.id, user.roleId);
  const impersonator = await resolveImpersonator(req.user!.impersonatorId);

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    roleIds,
    roleName: role?.nameJson ?? {},
    language: user.language,
    direction: user.direction,
    startPageId: user.startPageId,
    isActive: user.isActive,
    permissions,
    isGuest: req.user!.guest ?? false,
    impersonator,
  });
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  const [user] = await db
    .select({ passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId));

  if (!user || !user.passwordHash) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await db
    .update(usersTable)
    .set({ passwordHash: newHash })
    .where(eq(usersTable.id, req.user!.userId));

  res.json({ success: true, message: "Password changed" });
});

router.post("/auth/impersonate", requireAuth, async (req, res): Promise<void> => {
  const parsed = ImpersonateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Gate: only superAdmin or the "users" admin capability may impersonate.
  const actorPerms = await getPermissions(req);
  if (!actorPerms.superAdmin && !actorPerms.admin.users) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const targetId = parsed.data.userId;

  const [target] = await db
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
    })
    .from(usersTable)
    .where(eq(usersTable.id, targetId));

  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const { roleIds: targetRoleIds, permissions: targetPerms } = await loadRoleContext(target.id, target.roleId);
  // No privilege escalation: a non-super admin cannot impersonate a superAdmin.
  if (!actorPerms.superAdmin && targetPerms.superAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Preserve the original admin across nested impersonation so "stop" always
  // returns to the real admin, not an intermediate impersonated user.
  const originalAdminId = req.user!.impersonatorId ?? req.user!.userId;

  const token = signToken({
    userId: target.id,
    roleId: target.roleId,
    impersonatorId: originalAdminId,
  });

  const [role] = await db
    .select({ nameJson: rolesTable.nameJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, target.roleId));

  const impersonator = await resolveImpersonator(originalAdminId);

  res.json({
    token,
    user: {
      id: target.id,
      email: target.email,
      firstName: target.firstName,
      lastName: target.lastName,
      roleId: target.roleId,
      roleIds: targetRoleIds,
      roleName: role?.nameJson ?? {},
      language: target.language,
      direction: target.direction,
      startPageId: target.startPageId,
      isActive: target.isActive,
      permissions: targetPerms,
      impersonator,
    },
  });
});

router.post("/auth/stop-impersonation", requireAuth, async (req, res): Promise<void> => {
  const impersonatorId = req.user!.impersonatorId;
  if (!impersonatorId) {
    res.status(400).json({ error: "Not impersonating" });
    return;
  }

  const [admin] = await db
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
    })
    .from(usersTable)
    .where(eq(usersTable.id, impersonatorId));

  if (!admin) {
    res.status(401).json({ error: "Original account not found" });
    return;
  }

  const token = signToken({ userId: admin.id, roleId: admin.roleId });

  const [role] = await db
    .select({ nameJson: rolesTable.nameJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, admin.roleId));

  const { roleIds, permissions } = await loadRoleContext(admin.id, admin.roleId);

  res.json({
    token,
    user: {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      roleId: admin.roleId,
      roleIds,
      roleName: role?.nameJson ?? {},
      language: admin.language,
      direction: admin.direction,
      startPageId: admin.startPageId,
      isActive: admin.isActive,
      permissions,
      impersonator: null,
    },
  });
});

export default router;
