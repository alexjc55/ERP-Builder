import { db, relationsTable, recordLinksTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { relationLinkLockViolation } from "./relation-lock";
import { emitEvent, EVENT_RECORD_UPDATED } from "./events";

/**
 * Shared core for every surface that WRITES record links. There are several
 * routes that change links (POST/DELETE /records/:id/links, the page-level and
 * the entity-level PUT .../related-link) — the transactional replace and the
 * post-commit record.updated emission MUST be identical across them, otherwise
 * automations silently stop firing from one UI path (this has happened).
 * Route-specific permission checks stay in the routes; everything below the
 * permission boundary lives here.
 */

// Drizzle wraps the pg driver error, so the SQLSTATE code (23505 for a unique
// violation) can live on err.cause rather than the top-level error. Walk the
// cause chain — checking only the top level silently misclassifies wrapped
// unique violations as generic 500s (e.g. a record_links cardinality conflict).
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Map a record_links unique-constraint violation to a friendly cardinality message. */
export function recordLinkUniqueMessage(err: unknown): string | null {
  if (!isUniqueViolation(err)) return null;
  const cause = err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  const constraint =
    [err, cause]
      .map((e) => (e && typeof e === "object" && "constraint" in e ? (e as { constraint?: string }).constraint : undefined))
      .find((c): c is string => typeof c === "string") ?? "";
  if (constraint === "record_link_source_one" || constraint === "record_link_target_one") {
    return "Эта запись уже связана с другой";
  }
  if (constraint === "record_link_unique") return "Эти записи уже связаны";
  return "Эти записи уже связаны";
}

export type ReplaceLinkResult =
  | { ok: true; previousLinkedIds: number[] }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Replace the single link on `baseRecordId`'s side of `relationId` with
 * `linkedRecordId` (or clear it when null), in one transaction:
 *  - locks the relation row (relationType copied into record_links cannot
 *    drift under a concurrent type change);
 *  - enforces the lockAfterCreate immutability boundary (TOCTOU-free);
 *  - returns the previously linked record ids so callers can notify them.
 * Cardinality unique-violations are mapped to a friendly 409.
 */
export async function replaceSingleRelationLink(opts: {
  relationId: number;
  entityId: number;
  baseRecordId: number;
  direction: "source" | "target";
  linkedRecordId: number | null;
}): Promise<ReplaceLinkResult> {
  const { relationId, entityId, baseRecordId, direction, linkedRecordId } = opts;
  let previousLinkedIds: number[] = [];
  try {
    const lockMsg = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(relationsTable)
        .where(eq(relationsTable.id, relationId))
        .limit(1)
        .for("update");
      if (!locked) throw new Error("relation_gone");
      const lockViolation = await relationLinkLockViolation(
        tx,
        entityId,
        relationId,
        baseRecordId,
        direction,
        linkedRecordId,
      );
      if (lockViolation) return lockViolation;
      // Remove the existing single link on the base record's side, then insert
      // the new one (or leave it cleared when linkedRecordId is null).
      const baseCol = direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
      const otherCol = direction === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId;
      const removed = await tx
        .delete(recordLinksTable)
        .where(and(eq(recordLinksTable.relationId, relationId), eq(baseCol, baseRecordId)))
        .returning({ other: otherCol });
      previousLinkedIds = removed.map((r) => r.other);
      if (linkedRecordId != null) {
        await tx.insert(recordLinksTable).values({
          relationId,
          relationType: locked.relationType,
          sourceRecordId: direction === "source" ? baseRecordId : linkedRecordId,
          targetRecordId: direction === "source" ? linkedRecordId : baseRecordId,
        });
      }
      return null;
    });
    if (lockMsg) return { ok: false, status: 400, error: lockMsg };
  } catch (err) {
    const msg = recordLinkUniqueMessage(err);
    if (msg) return { ok: false, status: 409, error: msg };
    throw err;
  }
  return { ok: true, previousLinkedIds };
}

/**
 * Post-commit notification for a link change: a link change alters the
 * effective relation value of the base record AND of the previously/newly
 * linked records even though values_json is untouched — emit record.updated
 * for all of them so automations can react. Every link-write surface must
 * call this after a successful write.
 */
export async function emitLinkChangedEvents(opts: {
  entityId: number;
  baseRecordId: number;
  relatedEntityId: number;
  /** Previously linked + newly linked record ids (duplicates fine). */
  affectedLinkedIds: number[];
  actorUserId: number | undefined;
  log?: { error: (obj: unknown, msg?: string) => void };
}): Promise<void> {
  const affected = [...new Set(opts.affectedLinkedIds)];
  await emitEvent(
    [
      {
        eventName: EVENT_RECORD_UPDATED,
        entityId: opts.entityId,
        recordId: opts.baseRecordId,
        payload: { actorUserId: opts.actorUserId, changedFields: [] },
      },
      ...affected.map((rid) => ({
        eventName: EVENT_RECORD_UPDATED,
        entityId: opts.relatedEntityId,
        recordId: rid,
        payload: { actorUserId: opts.actorUserId, changedFields: [] },
      })),
    ],
    opts.log,
  );
}
