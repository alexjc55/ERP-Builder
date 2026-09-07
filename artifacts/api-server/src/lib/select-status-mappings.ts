import { db, entityStatusesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { SelectOption } from "./selectOptions";

/**
 * Validate status bindings shared by entity and page select-field CRUD.
 * A page without an effective entity may keep ordinary options, but cannot own
 * bindings because there is no record status for a value write to synchronize.
 */
export async function validateSelectStatusMappings(
  entityId: number | null,
  options: SelectOption[],
): Promise<string | null> {
  const ids = [...new Set(options.flatMap((option) => option.statusId ? [option.statusId] : []))];
  if (ids.length === 0) return null;
  if (entityId == null) return "Status mappings require the page to be bound to an entity";
  const found = await db
    .select({ id: entityStatusesTable.id })
    .from(entityStatusesTable)
    .where(and(eq(entityStatusesTable.entityId, entityId), inArray(entityStatusesTable.id, ids)));
  const foundIds = new Set(found.map((status) => status.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  return missing.length > 0
    ? `System status does not belong to this entity: ${missing.join(", ")}`
    : null;
}