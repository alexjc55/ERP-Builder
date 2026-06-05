import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import { db, usersTable, rolesTable, guestLinksTable, loginHistoryTable } from "@workspace/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { signToken } from "../lib/jwt";
import { requireAuth } from "../middlewares/auth";
import { requireAdmin, loadPermissions } from "../middlewares/permissions";
import {
  RedeemGuestLinkBody,
  CreateGuestLinkBody,
  CreateGuestLinkParams,
  ListGuestLinksParams,
  RevokeGuestLinkParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isLinkActive(row: { revokedAt: Date | null; expiresAt: Date | null }): boolean {
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

function serializeLink(row: typeof guestLinksTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    isActive: isLinkActive(row),
  };
}

/** Build the public, ready-to-share guest URL for a token. */
function buildGuestUrl(req: Request, token: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? req.protocol;
  const host = req.get("host") ?? "";
  return `${proto}://${host}/guest/${token}`;
}

// Public: exchange a guest link token for a read-only session. No auth required.
router.post("/guest/redeem", async (req, res): Promise<void> => {
  const parsed = RedeemGuestLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const tokenHash = hashToken(parsed.data.token);

  const [link] = await db
    .select()
    .from(guestLinksTable)
    .where(eq(guestLinksTable.tokenHash, tokenHash));

  if (!link || !isLinkActive(link)) {
    res.status(401).json({ error: "Invalid, expired, or revoked link" });
    return;
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
      passwordHash: usersTable.passwordHash,
    })
    .from(usersTable)
    .where(eq(usersTable.id, link.userId));

  // Guest links are valid only for passwordless accounts. If a password was ever set
  // on this account, the guest link must stop working: a credentialed account must not
  // be reachable through the passwordless, read-only guest path.
  if (!user || !user.isActive || user.passwordHash !== null) {
    res.status(401).json({ error: "Invalid, expired, or revoked link" });
    return;
  }

  await db
    .update(guestLinksTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(guestLinksTable.id, link.id));

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "";
  await db.insert(loginHistoryTable).values({
    userId: user.id,
    ipAddress: ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  const token = signToken({ userId: user.id, roleId: user.roleId, guest: true });

  const [role] = await db
    .select({ nameJson: rolesTable.nameJson })
    .from(rolesTable)
    .where(eq(rolesTable.id, user.roleId));

  const permissions = await loadPermissions(user.roleId);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      roleName: role?.nameJson ?? {},
      language: user.language,
      direction: user.direction,
      startPageId: user.startPageId,
      isActive: user.isActive,
      permissions,
    },
  });
});

// Admin: list guest links for a user.
router.get("/users/:id/guest-links", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = ListGuestLinksParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rows = await db
    .select()
    .from(guestLinksTable)
    .where(eq(guestLinksTable.userId, params.data.id))
    .orderBy(desc(guestLinksTable.createdAt));

  res.json(rows.map(serializeLink));
});

// Admin: create a guest link for a user. The plaintext token is returned only here.
router.post("/users/:id/guest-links", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = CreateGuestLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateGuestLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Guest links may only be issued for passwordless ("guest") accounts. This keeps the
  // design invariant — client = passwordless user — enforced server-side, so a
  // credentialed/privileged account can never be handed a read-only guest link.
  if (user.passwordHash !== null) {
    res.status(400).json({ error: "Guest links can only be created for passwordless (guest) users" });
    return;
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;

  const [row] = await db
    .insert(guestLinksTable)
    .values({
      userId: params.data.id,
      tokenHash,
      label: parsed.data.label ?? null,
      expiresAt,
      createdBy: req.user!.userId,
    })
    .returning();

  res.json({
    link: serializeLink(row),
    token,
    url: buildGuestUrl(req, token),
  });
});

// Admin: revoke a guest link.
router.post("/guest-links/:id/revoke", requireAuth, requireAdmin("users"), async (req, res): Promise<void> => {
  const params = RevokeGuestLinkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [updated] = await db
    .update(guestLinksTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(guestLinksTable.id, params.data.id), isNull(guestLinksTable.revokedAt)))
    .returning({ id: guestLinksTable.id });

  if (!updated) {
    // Either not found or already revoked; check existence to return the right code.
    const [existing] = await db
      .select({ id: guestLinksTable.id })
      .from(guestLinksTable)
      .where(eq(guestLinksTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Guest link not found" });
      return;
    }
  }

  res.json({ success: true, message: "Revoked" });
});

export default router;
