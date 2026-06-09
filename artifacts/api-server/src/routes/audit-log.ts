import { Router, type IRouter } from "express";
import { db, auditLogTable, entityRecordsTable, entityFieldsTable, usersTable, type InsertAuditLog, type EntityField } from "@workspace/db";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  assertRecord,
  getPermissions,
  getUserRoleIds,
  effectiveScope,
  recordOwnedBy,
  resolveFieldAccess,
} from "../middlewares/permissions";
import { GetRecordParams } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Reserved audit field keys for changes that are not entity data fields.
 * `__status__` — record status changed; `__archived__` — manual/auto archival
 * flipped; `__created__` — record created (used when no data fields were set);
 * `__deleted__` — record deleted (old value carries a snapshot of the data).
 */
export const AUDIT_STATUS = "__status__";
export const AUDIT_ARCHIVED = "__archived__";
export const AUDIT_CREATED = "__created__";
export const AUDIT_DELETED = "__deleted__";

/** Stringify any value for storage in the audit log's text columns. */
export function auditStr(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Compute field-level changes between two value maps for the given field keys.
 * Only keys whose stringified value actually changed are returned.
 */
export function diffValues(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldKeys: string[],
): { fieldKey: string; oldValue: string | null; newValue: string | null }[] {
  const changes: { fieldKey: string; oldValue: string | null; newValue: string | null }[] = [];
  for (const key of fieldKeys) {
    const oldValue = auditStr(before[key]);
    const newValue = auditStr(after[key]);
    if (oldValue !== newValue) changes.push({ fieldKey: key, oldValue, newValue });
  }
  return changes;
}

/**
 * Best-effort append to the audit log. Audit writes must never break the
 * underlying data mutation, so failures are swallowed (logged by the caller's
 * request logger if provided).
 */
export async function writeAudit(
  entries: InsertAuditLog[],
  log?: { error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db.insert(auditLogTable).values(entries);
  } catch (err) {
    log?.error({ err }, "Failed to write audit log");
  }
}

router.get("/records/:id/audit", requireAuth, async (req, res): Promise<void> => {
  const params = GetRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [record] = await db
    .select({ entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson })
    .from(entityRecordsTable)
    .where(eq(entityRecordsTable.id, params.data.id))
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  // Viewing a record's history requires the same access as viewing the record.
  if (!(await assertRecord(req, res, record.entityId, "view"))) return;

  const perms = await getPermissions(req);
  const { scope, scopeFieldKeys } = effectiveScope(perms, record.entityId);
  const values = (record.valuesJson as Record<string, unknown>) ?? {};
  if (scope === "own" && !recordOwnedBy(values, scopeFieldKeys, req.user!.userId)) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  // Mirror the record endpoints' field-level boundary: history must never reveal
  // values of fields the requester cannot see. Resolve the hidden field keys for
  // this requester so we can drop hidden field entries and redact reserved
  // snapshots (e.g. the __deleted__ marker carries a full values snapshot).
  const fields: EntityField[] = await db
    .select()
    .from(entityFieldsTable)
    .where(and(eq(entityFieldsTable.entityId, record.entityId), eq(entityFieldsTable.isActive, true)))
    .orderBy(asc(entityFieldsTable.sortOrder));
  const roleIds = await getUserRoleIds(req);
  const hidden = new Set<string>();
  for (const f of fields) {
    if (resolveFieldAccess(f, perms, roleIds, record.entityId) === "hidden") hidden.add(f.fieldKey);
  }

  /** Redact hidden keys from a stored JSON values snapshot (e.g. __deleted__). */
  const redactSnapshot = (raw: string | null): string | null => {
    if (raw === null || hidden.size === 0) return raw;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const k of hidden) delete parsed[k];
      return JSON.stringify(parsed);
    } catch {
      return raw;
    }
  };

  const allRows = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.recordId, params.data.id))
    .orderBy(desc(auditLogTable.id));

  const rows = allRows
    // Drop entries for data fields the requester cannot see.
    .filter((r) => r.fieldKey == null || !hidden.has(r.fieldKey))
    // Redact hidden keys from the deletion snapshot.
    .map((r) =>
      r.fieldKey === AUDIT_DELETED
        ? { ...r, oldValue: redactSnapshot(r.oldValue), newValue: redactSnapshot(r.newValue) }
        : r,
    );

  // Resolve actor names in one round-trip.
  const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is number => id != null))];
  const nameById = new Map<number, string>();
  if (userIds.length > 0) {
    const users = await db
      .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
      nameById.set(u.id, name || u.email);
    }
  }

  res.json(
    rows.map((r) => ({
      ...r,
      userName: r.userId != null ? nameById.get(r.userId) ?? null : null,
    })),
  );
});

export default router;
