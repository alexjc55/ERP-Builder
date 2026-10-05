import { db, entityFieldsTable, pageFieldsTable, pagesTable, relationsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { webhookDisplay, webhookFile, webhookLabel, type WebhookLanguage } from "./automation-webhook-display";
import { webhookFileAliases } from "./automation-webhook-files";

type Field = typeof entityFieldsTable.$inferSelect | typeof pageFieldsTable.$inferSelect;
type Options = { includeRecord: boolean; language?: WebhookLanguage };
const selectOptions = (value: unknown): { value: string; labelJson?: unknown }[] =>
  Array.isArray(value) ? value.map(o => typeof o === "string" ? { value: o } : o) : [];

/** Synthetic values only. No record, user, file or page-value reads or writes. */
export function syntheticFieldValue(field: Pick<Field, "fieldType" | "optionsJson">): unknown {
  const first = selectOptions(field.optionsJson)[0]?.value;
  switch (field.fieldType) {
    case "number": case "percent": case "function": return 123.45;
    case "boolean": return true;
    case "date": return "2026-01-15";
    case "created_at": return "2026-01-15T12:00:00.000Z";
    case "user": return 0;
    case "select": return first ?? "test";
    case "multiselect": return [first ?? "test"];
    case "file": return { kind: "link", url: "https://example.invalid/test.txt", name: "test.txt" };
    case "relation": case "lookup": return null;
    default: return "TEST";
  }
}

export async function buildWebhookTestPayload(entityId: number, options: Options) {
  if (!options.includeRecord) return { test: true, entityId, recordId: 0 };
  const language = options.language ?? "ru";
  const [defs, mirrors, relations] = await Promise.all([
    db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, entityId), eq(entityFieldsTable.isActive, true))),
    db.select().from(pagesTable).where(eq(pagesTable.mirrorEntityId, entityId)),
    db.select().from(relationsTable),
  ]);
  const localDefs = mirrors.length ? await db.select().from(pageFieldsTable).where(and(
    inArray(pageFieldsTable.pageId, mirrors.map(p => p.id)), eq(pageFieldsTable.isActive, true),
  )) : [];
  // Resolve only schema dependencies, never real linked records.
  const fieldCache = new Map<number, Field[]>([[entityId, defs]]);
  const localCache = new Map<number, Field[]>(mirrors.map(p => [p.id, localDefs.filter(f => f.pageId === p.id)]));
  let count = 0;
  const project = async (field: Field, owner: number, pageId: number | null, contextPageId = pageId, depth = 0): Promise<Record<string, unknown>> => {
    if (++count > 5000) throw new Error("payload_too_large");
    const sample = syntheticFieldValue(field);
    let value: unknown = sample;
    if (field.fieldType === "file") value = webhookFile(sample);
    if (field.fieldType === "user") value = { id: 0, name: "TEST User" };
    if (field.fieldType === "select" || field.fieldType === "multiselect") {
      const resolve = (id: unknown) => {
        const option = selectOptions(field.optionsJson).find(o => o.value === id);
        const labelJson = option?.labelJson ?? {};
        return { id, labelJson, label: webhookLabel(labelJson, language) || String(id) };
      };
      value = Array.isArray(sample) ? sample.map(resolve) : resolve(sample);
    }
    if (field.fieldType === "relation" || field.fieldType === "lookup") {
      value = [];
      const cfg = field.relationConfigJson;
      const rel = relations.find(r => r.id === cfg.relationId);
      if (rel && depth < 3) {
        const targetId = rel.sourceEntityId === owner ? rel.targetEntityId : rel.sourceEntityId;
        const targetPage = cfg.relatedPageId ?? null;
        const cache = targetPage == null ? fieldCache : localCache;
        const cacheKey = targetPage ?? targetId;
        if (!cache.has(cacheKey)) cache.set(cacheKey, targetPage == null
          ? await db.select().from(entityFieldsTable).where(and(eq(entityFieldsTable.entityId, targetId), eq(entityFieldsTable.isActive, true)))
          : await db.select().from(pageFieldsTable).where(and(eq(pageFieldsTable.pageId, targetPage), eq(pageFieldsTable.isActive, true))));
        const targetField = cache.get(cacheKey)?.find(f => f.fieldKey === cfg.relatedFieldKey);
        const projection = targetField ? await project(targetField, targetId, targetPage, targetPage, depth + 1) : null;
        value = [{ relationId: rel.id, linkId: 0, entityId: targetId, recordId: 0, pageId: targetPage,
          field: projection, resolvedValue: projection?.resolvedValue ?? null, displayValue: projection?.displayValue ?? "" }];
      }
    }
    return {
      key: pageId != null ? `page:${pageId}.${field.fieldKey}` : contextPageId != null
        ? `entity-context:${owner}:page:${contextPageId}.${field.fieldKey}` : `entity:${owner}.${field.fieldKey}`,
      fieldKey: field.fieldKey, entityId: owner, pageId, contextPageId,
      name: webhookLabel(field.nameJson, language), nameJson: field.nameJson, type: field.fieldType,
      rawValue: ["relation", "lookup", "function"].includes(field.fieldType) ? null : sample,
      resolvedValue: value, displayValue: webhookDisplay(value, field, language, "UTC"),
    };
  };
  const fields = [];
  for (const f of defs) fields.push(await project(f, entityId, null));
  for (const p of mirrors) {
    for (const f of defs.filter(f => f.fieldType === "function")) fields.push(await project(f, entityId, null, p.id));
    for (const f of localDefs.filter(f => f.pageId === p.id)) fields.push(await project(f, entityId, p.id));
  }
  return { test: true, entityId, recordId: 0,
    values: Object.fromEntries(defs.map(f => [f.fieldKey, ["relation", "lookup"].includes(f.fieldType) ? ["TEST"] : syntheticFieldValue(f)])),
    statusId: null, schemaVersion: 2, language, pageId: null, fields, ...webhookFileAliases(fields) };
}
