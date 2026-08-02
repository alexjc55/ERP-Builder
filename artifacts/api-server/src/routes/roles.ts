import { Router, type IRouter } from "express";
import { db, rolesTable, usersTable, pageFieldsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
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

/**
 * Page-local field types that may back a "filter" row-scope condition — the
 * value-backed types stored in page_record_values. function/formula compute at
 * render time and relation/lookup/file store no comparable scalar.
 */
const PAGE_SCOPE_FILTERABLE_TYPES = new Set<string>([
  "text", "textarea", "email", "url", "phone", "select", "number", "percent", "boolean", "date", "datetime", "user",
]);

/**
 * Validate page-local (pageId-bearing) scope filters inside permissionsJson
 * before persisting a role. This is an access-control CONFIG boundary: a
 * page-local condition is only meaningful on the mirror override of that very
 * page (`records["mirror:<pageId>"]`) and must reference an ACTIVE value-backed
 * field of that page. Anything else (pageId on an entity-level scope, a foreign
 * page's id, an unknown/derived field) is a misconfiguration — reject it rather
 * than persisting a rule that silently never matches or points at another page.
 * Runtime enforcement stays deny-safe regardless (an unknown condition only
 * narrows), but bad configs must not be storable in the first place.
 */
async function validatePageScopeFilters(
  permissionsJson: unknown,
): Promise<string | null> {
  const records = (permissionsJson as { records?: Record<string, unknown> } | null)?.records;
  if (!records || typeof records !== "object") return null;
  for (const [key, perm] of Object.entries(records)) {
    const scopeFilters = (perm as { scopeFilters?: unknown } | null)?.scopeFilters;
    if (!Array.isArray(scopeFilters)) continue;
    for (const fl of scopeFilters) {
      const pageId = (fl as { pageId?: unknown })?.pageId;
      if (pageId == null) continue;
      const fieldKey = (fl as { fieldKey?: unknown })?.fieldKey;
      const mirrorMatch = /^mirror:(\d+)$/.exec(key);
      if (!mirrorMatch) {
        return `Page-local scope filter (pageId ${String(pageId)}) is only allowed on a mirror-page override, not on records["${key}"]`;
      }
      if (Number(mirrorMatch[1]) !== Number(pageId)) {
        return `Page-local scope filter pageId ${String(pageId)} does not match its mirror override page ${mirrorMatch[1]}`;
      }
      if (typeof fieldKey !== "string" || fieldKey.length === 0) {
        return `Page-local scope filter on page ${String(pageId)} is missing a fieldKey`;
      }
      const [pf] = await db
        .select()
        .from(pageFieldsTable)
        .where(
          and(
            eq(pageFieldsTable.pageId, Number(pageId)),
            eq(pageFieldsTable.fieldKey, fieldKey),
            eq(pageFieldsTable.isActive, true),
          ),
        );
      if (!pf) {
        return `Unknown or inactive page field "${fieldKey}" for page-local scope filter on page ${String(pageId)}`;
      }
      if (!PAGE_SCOPE_FILTERABLE_TYPES.has(pf.fieldType)) {
        return `Page field "${fieldKey}" (${pf.fieldType}) cannot back a value-based scope filter`;
      }
    }
  }
  return null;
}

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

  const scopeErr = await validatePageScopeFilters(parsed.data.permissionsJson);
  if (scopeErr) {
    res.status(400).json({ error: scopeErr });
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
  if (parsed.data.permissionsJson != null) {
    const scopeErr = await validatePageScopeFilters(parsed.data.permissionsJson);
    if (scopeErr) {
      res.status(400).json({ error: scopeErr });
      return;
    }
    updateData.permissionsJson = parsed.data.permissionsJson;
  }

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
