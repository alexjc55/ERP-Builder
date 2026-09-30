import type { Relation, RelationFieldConfig } from "@workspace/db";

/** Direction/cardinality is metadata, never inferred from a projected label. */
export function selectionDirection(
  relation: Pick<Relation, "sourceEntityId" | "targetEntityId" | "relationType">,
  entityId: number,
  config?: RelationFieldConfig | null,
): "source" | "target" | null {
  const multiple = config?.selectionMode === "multiple";
  const type = relation.relationType;
  if (relation.sourceEntityId === entityId &&
      (multiple ? type === "many_to_many" || type === "one_to_many" : type === "one_to_one" || type === "many_to_one")) return "source";
  if (relation.targetEntityId === entityId &&
      (multiple ? type === "many_to_many" || type === "many_to_one" : type === "one_to_one" || type === "one_to_many")) return "target";
  return null;
}

export function normalizeSelection(input: { linkedRecordId?: number | null; linkedRecordIds?: number[] }, multiple: boolean): number[] {
  if (input.linkedRecordIds !== undefined && input.linkedRecordId !== undefined) throw new Error("Specify linkedRecordIds or linkedRecordId, not both");
  const ids = input.linkedRecordIds ?? (input.linkedRecordId == null ? [] : [input.linkedRecordId]);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid linked record id");
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate linked record id");
  if (!multiple && ids.length > 1) throw new Error("This relation field permits one selection");
  return [...ids].sort((a, b) => a - b);
}