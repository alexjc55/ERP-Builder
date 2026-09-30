import { type Relation } from "@workspace/db";

/** Direction is explicit for self relations; never guess which endpoint to use. */
export function relatedStatusTarget(
  relation: Pick<Relation, "sourceEntityId" | "targetEntityId">,
  entityId: number,
  direction?: "forward" | "reverse",
): { entityId: number; forward: boolean } {
  const source = relation.sourceEntityId === entityId;
  const target = relation.targetEntityId === entityId;
  if (!source && !target) throw new Error("Relation does not belong to the triggering entity");
  if (source && target && !direction) throw new Error("Self relation requires relationDirection");
  const forward = direction ? direction === "forward" : source;
  if ((forward && !source) || (!forward && !target)) throw new Error("Relation direction does not belong to the triggering entity");
  return { entityId: forward ? relation.targetEntityId : relation.sourceEntityId, forward };
}