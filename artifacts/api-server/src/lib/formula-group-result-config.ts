import {
  db,
  entitiesTable,
  entityFieldsTable,
  pageFieldsTable,
  pagesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

type FormulaGroupReference =
  | { scope: "entity"; fieldKey: string }
  | { scope: "page"; pageId: number; fieldKey: string };

type FormulaGroupConfigLike = {
  groupResult?: {
    enabled?: boolean;
    fields?: FormulaGroupReference[];
  };
};

type FormulaGroupOwner =
  | { kind: "entity"; entityId: number }
  | { kind: "page"; pageId: number };

const unsupportedKeyTypes = new Set(["file", "relation", "lookup", "page_ref"]);

async function effectiveEntityId(pageId: number): Promise<number | null> {
  const [page] = await db
    .select({ mirrorEntityId: pagesTable.mirrorEntityId })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId));
  if (!page) return null;
  if (page.mirrorEntityId != null) return page.mirrorEntityId;
  const [entity] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.pageId, pageId));
  return entity?.id ?? null;
}

/**
 * Validates persisted group-result references against the canonical schema.
 * Viewer-specific field visibility is checked again at records-query time.
 */
export async function validateFormulaGroupResultReferences(
  owner: FormulaGroupOwner,
  config: FormulaGroupConfigLike | null | undefined,
): Promise<string[]> {
  const refs = config?.groupResult?.fields;
  if (!Array.isArray(refs) || refs.length === 0) return [];

  const ownerEntityId =
    owner.kind === "entity" ? owner.entityId : await effectiveEntityId(owner.pageId);
  const errors: string[] = [];

  const entityKeys = [...new Set(
    refs.filter((ref) => ref.scope === "entity").map((ref) => ref.fieldKey),
  )];
  if (entityKeys.length > 0) {
    if (ownerEntityId == null) {
      errors.push("groupResult entity references require the page to be bound to an entity");
    } else {
      const fields = await db
        .select({ fieldKey: entityFieldsTable.fieldKey, fieldType: entityFieldsTable.fieldType })
        .from(entityFieldsTable)
        .where(and(
          eq(entityFieldsTable.entityId, ownerEntityId),
          eq(entityFieldsTable.isActive, true),
          inArray(entityFieldsTable.fieldKey, entityKeys),
        ));
      const valid = new Set(fields
        .filter((field) => !unsupportedKeyTypes.has(field.fieldType))
        .map((field) => field.fieldKey));
      for (const key of entityKeys) {
        if (!valid.has(key)) errors.push(`groupResult entity field "${key}" is missing, inactive, or unsupported`);
      }
    }
  }

  const pageRefs = refs.filter(
    (ref): ref is Extract<FormulaGroupReference, { scope: "page" }> => ref.scope === "page",
  );
  if (pageRefs.length > 0) {
    const pageIds = [...new Set(pageRefs.map((ref) => ref.pageId))];
    const pageEntities = new Map<number, number | null>();
    for (const pageId of pageIds) pageEntities.set(pageId, await effectiveEntityId(pageId));

    const validPages = new Set(pageIds.filter((pageId) =>
      owner.kind === "page"
        ? pageId === owner.pageId
        : pageEntities.get(pageId) === ownerEntityId,
    ));
    const keys = [...new Set(pageRefs.map((ref) => ref.fieldKey))];
    const fields = validPages.size > 0
      ? await db
          .select({
            pageId: pageFieldsTable.pageId,
            fieldKey: pageFieldsTable.fieldKey,
            fieldType: pageFieldsTable.fieldType,
          })
          .from(pageFieldsTable)
          .where(and(
            inArray(pageFieldsTable.pageId, [...validPages]),
            eq(pageFieldsTable.isActive, true),
            inArray(pageFieldsTable.fieldKey, keys),
          ))
      : [];
    const valid = new Set(fields
      .filter((field) => !unsupportedKeyTypes.has(field.fieldType))
      .map((field) => `${field.pageId}:${field.fieldKey}`));
    for (const ref of pageRefs) {
      if (!validPages.has(ref.pageId)) {
        errors.push(`groupResult page ${ref.pageId} is outside the formula context`);
      } else if (!valid.has(`${ref.pageId}:${ref.fieldKey}`)) {
        errors.push(`groupResult page field "${ref.pageId}:${ref.fieldKey}" is missing, inactive, or unsupported`);
      }
    }
  }

  return errors;
}