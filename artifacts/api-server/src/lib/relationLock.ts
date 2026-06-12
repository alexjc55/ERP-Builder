import { db, entityFieldsTable, recordLinksTable, relationsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

// Accepts either the base db handle or a transaction. Both expose an identical
// `select` builder; narrowing to just that capability lets callers run these
// reads with or without an enclosing transaction (a tx lacks db's `$client`).
type Tx = Pick<typeof db, "select">;

/**
 * A relation entity-field with `lockAfterCreate` makes its link immutable once
 * set: the underlying `record_links` row backing it can no longer be changed or
 * cleared. The relation *value* is derived (never in valuesJson), so the records
 * UPDATE path's `checkImmutableFields` never sees it — the lock must be enforced
 * wherever the link itself is mutated.
 *
 * The lock lives on a FIELD but the value is the shared link, so we treat it as a
 * property of the (relationId, side) "link contour": if ANY relation field on the
 * base entity over the same relation is locked, the link is locked for that side.
 * This also closes the bypass where a second, unlocked relation field over the
 * same relation could be used to mutate a locked field's link.
 *
 * Returns which sides of a relation carry at least one locked relation field.
 * `null` when the relation no longer exists.
 */
export async function getRelationLockSides(
  tx: Tx,
  relationId: number,
): Promise<{ sourceLocked: boolean; targetLocked: boolean } | null> {
  const [relation] = await tx
    .select({ sourceEntityId: relationsTable.sourceEntityId, targetEntityId: relationsTable.targetEntityId })
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);
  if (!relation) return null;

  const lockedFields = await tx
    .select({ entityId: entityFieldsTable.entityId })
    .from(entityFieldsTable)
    .where(
      and(
        eq(entityFieldsTable.fieldType, "relation"),
        eq(entityFieldsTable.lockAfterCreate, true),
        // relationConfigJson is {relationId, relatedFieldKey}; ->> extracts as text.
        sql`${entityFieldsTable.relationConfigJson} ->> 'relationId' = ${String(relationId)}`,
      ),
    );

  return {
    sourceLocked: lockedFields.some((f) => f.entityId === relation.sourceEntityId),
    targetLocked: lockedFields.some((f) => f.entityId === relation.targetEntityId),
  };
}

/**
 * True when a link already exists for `(relationId, baseRecordId)` on the given
 * side. Used together with {@link getRelationLockSides}: first-set (no existing
 * link) is always allowed; only a later change/clear is blocked.
 */
export async function linkExistsForSide(
  tx: Tx,
  relationId: number,
  side: "source" | "target",
  baseRecordId: number,
): Promise<boolean> {
  const baseCol = side === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
  const [existing] = await tx
    .select({ id: recordLinksTable.id })
    .from(recordLinksTable)
    .where(and(eq(recordLinksTable.relationId, relationId), eq(baseCol, baseRecordId)))
    .limit(1);
  return !!existing;
}

/** Sentinel thrown inside a transaction when a locked relation link would change. */
export const RELATION_LOCKED = "relation_locked";
