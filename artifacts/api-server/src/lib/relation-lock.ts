import {
  db,
  entityFieldsTable,
  recordLinksTable,
  type RelationFieldConfig,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/**
 * Hard immutability boundary for `lockAfterCreate` relation fields, enforced on
 * the record_link write path. A relation field's value is a derived record_link
 * (not a JSONB scalar), so the scalar `checkImmutableFields` guard never covers
 * it — this is the dedicated equivalent. Once a link exists for a locked
 * relation field on a given base record, the link can neither be re-pointed nor
 * cleared (setting the SAME linked id is a no-op and allowed; the first set,
 * when no link yet exists, is allowed). There is no superAdmin exception:
 * durable integrity is the entire point of the flag.
 *
 * `lockAfterCreate` lives only on entity fields, so this is keyed on the base
 * record's entity regardless of whether the editing surface is an entity field
 * or a (mirror/page) relation page-field bound to the same relation. Pass the
 * SAME `exec` (`tx`) used by the surrounding relation-locked transaction so the
 * check is free of TOCTOU races against concurrent link writes.
 *
 * Returns a localized error message string when the change is forbidden, or
 * `null` when it is allowed.
 */
export async function relationLinkLockViolation(
  exec: Exec,
  baseEntityId: number,
  relationId: number,
  baseRecordId: number,
  direction: "source" | "target",
  newLinkedId: number | null,
): Promise<string | null> {
  const candidates = await exec
    .select({
      nameJson: entityFieldsTable.nameJson,
      fieldKey: entityFieldsTable.fieldKey,
      cfg: entityFieldsTable.relationConfigJson,
    })
    .from(entityFieldsTable)
    .where(
      and(
        eq(entityFieldsTable.entityId, baseEntityId),
        eq(entityFieldsTable.fieldType, "relation"),
        eq(entityFieldsTable.lockAfterCreate, true),
        eq(entityFieldsTable.isActive, true),
      ),
    );
  const locked = candidates.find(
    (f) => (f.cfg as RelationFieldConfig | null)?.relationId === relationId,
  );
  if (!locked) return null;

  const baseCol =
    direction === "source" ? recordLinksTable.sourceRecordId : recordLinksTable.targetRecordId;
  const linkedCol =
    direction === "source" ? recordLinksTable.targetRecordId : recordLinksTable.sourceRecordId;
  const [existing] = await exec
    .select({ linkedId: linkedCol })
    .from(recordLinksTable)
    .where(and(eq(recordLinksTable.relationId, relationId), eq(baseCol, baseRecordId)))
    .limit(1);
  if (existing && existing.linkedId !== newLinkedId) {
    const ru = (locked.nameJson as { ru?: string } | null)?.ru ?? locked.fieldKey;
    return `Поле «${ru}» нельзя изменить после создания записи`;
  }
  return null;
}
