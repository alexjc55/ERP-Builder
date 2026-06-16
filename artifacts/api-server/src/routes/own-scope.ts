import { sql, and, or, eq, inArray, type SQL } from "drizzle-orm";
import { db, entityRecordsTable, relationsTable, type EntityField } from "@workspace/db";
import { relationDirection, ownRelationExists, type RelationFilterMeta } from "./record-query";

/**
 * Resolve filter/own-scope metadata for the `relation` & `lookup` fields among
 * the given fields. These field types store no value in values_json — their
 * displayed value is the projected `relatedFieldKey` of a single linked record
 * reached via record_links. The returned map (fieldKey → meta) lets a query
 * match them with an EXISTS subquery. Only fields whose relation resolves to a
 * single-link direction for `entityId` are included. The caller controls which
 * fields are passed (e.g. only visible fields for filtering, or only the owner
 * fields for own-scope), so visibility is enforced by the caller.
 */
export async function buildRelationMeta(
  entityId: number,
  fields: EntityField[],
): Promise<Map<string, RelationFilterMeta>> {
  const meta = new Map<string, RelationFilterMeta>();
  const relFields = fields.filter(
    (f) =>
      (f.fieldType === "relation" || f.fieldType === "lookup") &&
      f.relationConfigJson?.relationId != null &&
      !!f.relationConfigJson?.relatedFieldKey,
  );
  if (relFields.length === 0) return meta;
  const relIds = [...new Set(relFields.map((f) => f.relationConfigJson!.relationId as number))];
  const relRows = await db.select().from(relationsTable).where(inArray(relationsTable.id, relIds));
  const relById = new Map(relRows.map((r) => [r.id, r]));
  for (const f of relFields) {
    const cfg = f.relationConfigJson!;
    const rel = relById.get(cfg.relationId as number);
    if (!rel) continue;
    const dir = relationDirection(rel, entityId);
    if (!dir) continue;
    meta.set(f.fieldKey, {
      relationId: cfg.relationId as number,
      relatedFieldKey: cfg.relatedFieldKey as string,
      direction: dir,
    });
  }
  return meta;
}

/**
 * Split a role's `scopeFieldKeys` (owner fields for the "own" row scope) into
 * native fields (whose user id sits directly in `values_json`) and relation /
 * lookup fields (whose ownership is designated by a projected user-type field on
 * the single linked record). A key that doesn't resolve to a relation/lookup
 * field is treated as native — comparing a non-existent value to the user id
 * simply never matches, so an unknown key can only under-include, never leak.
 */
function partitionOwnerFields(
  scopeFieldKeys: string[],
  fields: EntityField[],
): { native: string[]; relation: EntityField[] } {
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));
  const native: string[] = [];
  const relation: EntityField[] = [];
  for (const k of scopeFieldKeys) {
    const f = byKey.get(k);
    if (
      f &&
      (f.fieldType === "relation" || f.fieldType === "lookup") &&
      f.relationConfigJson?.relationId != null &&
      !!f.relationConfigJson?.relatedFieldKey
    ) {
      relation.push(f);
    } else {
      native.push(k);
    }
  }
  return { native, relation };
}

/**
 * SQL predicate over `entity_records` selecting rows OWNED by `userId` under the
 * "own" row scope. A row is owned when ANY owner field designates the user:
 * - native field: `values_json ->> key = userId`
 * - relation/lookup field: the single linked record's projected user field
 *   equals `userId` (EXISTS through record_links, see {@link ownRelationExists}).
 *
 * Field-type awareness is REQUIRED: a relation/lookup field has no value in
 * `values_json`, so the legacy `values_json ->> key` form would always fail and
 * hide every row. With no resolvable owner fields the predicate is `false` (own
 * scope hides everything, the safe default). `fields` must be the entity's
 * active fields so each owner key can be classified.
 */
export async function ownScopeWhere(
  entityId: number,
  scopeFieldKeys: string[],
  userId: number,
  fields: EntityField[],
): Promise<SQL> {
  if (scopeFieldKeys.length === 0) return sql`false`;
  const { native, relation } = partitionOwnerFields(scopeFieldKeys, fields);
  const clauses: SQL[] = native.map(
    (k) => sql`(${entityRecordsTable.valuesJson} ->> ${k}) = ${String(userId)}`,
  );
  if (relation.length > 0) {
    const meta = await buildRelationMeta(entityId, relation);
    for (const f of relation) {
      const m = meta.get(f.fieldKey);
      if (m) clauses.push(ownRelationExists(m, userId));
    }
  }
  if (clauses.length === 0) return sql`false`;
  return or(...clauses)!;
}

/**
 * Whether a single record is owned by `userId` under the "own" row scope. Used
 * for the per-record re-check on read-by-id / update / delete / archive and on
 * file/history surfaces, so it MUST agree with {@link ownScopeWhere} exactly.
 *
 * Fast path: native owner fields are checked in-memory against the record's
 * values (no DB hit) — preserving the previous behaviour for the common case of
 * native `user` owner fields. Only when relation/lookup owner fields are present
 * and no native field already matched do we run a single EXISTS query scoped to
 * this record id, reusing the same relation predicate as the list filter.
 */
export async function isRecordOwned(
  entityId: number,
  record: { id: number; valuesJson: unknown },
  scopeFieldKeys: string[],
  userId: number,
  fields: EntityField[],
): Promise<boolean> {
  if (scopeFieldKeys.length === 0) return false;
  const { native, relation } = partitionOwnerFields(scopeFieldKeys, fields);
  const values = (record.valuesJson as Record<string, unknown>) ?? {};
  // Compare as text to match ownScopeWhere's SQL `values_json ->> key = <userId>`
  // exactly (the `->>` operator yields the textual representation). A numeric
  // compare here would diverge for odd stored forms like "01"/"1.0", letting the
  // single-record re-check accept a row the list filter would hide.
  for (const k of native) {
    const v = values[k];
    if (v != null && String(v) === String(userId)) return true;
  }
  if (relation.length === 0) return false;
  const meta = await buildRelationMeta(entityId, relation);
  const relClauses: SQL[] = [];
  for (const f of relation) {
    const m = meta.get(f.fieldKey);
    if (m) relClauses.push(ownRelationExists(m, userId));
  }
  if (relClauses.length === 0) return false;
  const [row] = await db
    .select({ id: entityRecordsTable.id })
    .from(entityRecordsTable)
    .where(and(eq(entityRecordsTable.id, record.id), or(...relClauses)!))
    .limit(1);
  return !!row;
}
