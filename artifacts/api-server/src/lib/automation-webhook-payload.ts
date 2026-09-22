import {
  db, entityFieldsTable, entityRecordsTable, pagesTable, pageFieldsTable,
  pageRecordValuesTable, relationsTable, recordLinksTable, usersTable,
  type EntityField, type PageField,
} from "@workspace/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { loadFormulaOptions, materializeVisibleEntityFormulas, materializeVisiblePageFormulas, mergeLinkedFormulaInputs, systemFormulaPermissions } from "./formula-runtime";
import { webhookDisplay, webhookFile, webhookLabel, type WebhookLanguage } from "./automation-webhook-display";
import { applyFormulaGroupResults, formulaGroupResultWinners, secureFormulaGroupConfigs } from "./formula-group-result";
import { aggregateLinkedValues } from "./linked-formula-resolver";

type Field = EntityField | PageField;
type RecordRow = typeof entityRecordsTable.$inferSelect;
type Page = typeof pagesTable.$inferSelect;
type Relation = typeof relationsTable.$inferSelect;
type Link = typeof recordLinksTable.$inferSelect;
type Projection = {
  key: string; fieldKey: string; entityId: number; pageId: number | null;
  name: string; nameJson: unknown; type: string; rawValue: unknown;
  resolvedValue: unknown; displayValue: string; error?: string;
};
const MAX_RECORDS = 500;
const MAX_DEPTH = 8;
const MAX_FIELDS = 5000;

/**
 * System-only automation export. Do not reuse for interactive API responses:
 * authority deliberately matches the automation engine, not its initiating user.
 * No formula expressions, permissions, auth tokens, or connection settings are exported.
 */
export async function buildAutomationWebhookPayload(
  entityId: number,
  recordId: number,
  options: { includeRecord?: boolean; pageId?: number; language?: WebhookLanguage; baseUrl?: string },
) {
  if (!options.includeRecord) return { entityId, recordId };
  const language = options.language ?? "ru";
  const baseUrl = options.baseUrl || process.env.WEBHOOK_ORIGIN;
  const [current] = await db.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.id, recordId), eq(entityRecordsTable.entityId, entityId)));
  if (!current) throw new Error("Webhook record no longer exists");
  const records = new Map<number, RecordRow>([[recordId, current]]);
  const fields = new Map<number, EntityField[]>();
  const pageFields = new Map<number, PageField[]>();
  const pages = new Map<number, Page>();
  const pageValues = new Map<string, Record<string, unknown>>();
  const relations = new Map<number, Relation>();
  const links = new Map<number, Link>();
  let frontier = [current];
  let fieldCount = 0;

  // Breadth-first batches avoid a query per linked record or projected field.
  for (let depth = 0; frontier.length; depth++) {
    if (depth > MAX_DEPTH) throw new Error(`Webhook projection exceeds ${MAX_DEPTH} relation levels`);
    const entityIds = [...new Set(frontier.map((r) => r.entityId))];
    const missing = entityIds.filter((id) => !fields.has(id));
    if (missing.length) {
      const [defs, pageRows, rels] = await Promise.all([
        db.select().from(entityFieldsTable).where(and(inArray(entityFieldsTable.entityId, missing), eq(entityFieldsTable.isActive, true))),
        db.select().from(pagesTable).where(inArray(pagesTable.mirrorEntityId, missing)),
        db.select().from(relationsTable).where(or(inArray(relationsTable.sourceEntityId, missing), inArray(relationsTable.targetEntityId, missing))),
      ]);
      for (const id of missing) fields.set(id, defs.filter((f) => f.entityId === id));
      for (const p of pageRows) pages.set(p.id, p);
      for (const rel of rels) relations.set(rel.id, rel);
      if (pageRows.length) {
        const pdefs = await db.select().from(pageFieldsTable).where(and(inArray(pageFieldsTable.pageId, pageRows.map((p) => p.id)), eq(pageFieldsTable.isActive, true)));
        for (const p of pageRows) pageFields.set(p.id, pdefs.filter((f) => f.pageId === p.id));
        fieldCount += pdefs.length;
      }
      fieldCount += defs.length;
      if (fieldCount > MAX_FIELDS) throw new Error(`Webhook projection exceeds ${MAX_FIELDS} fields`);
    }
    const ids = frontier.map((r) => r.id);
    const applicablePages = [...pages.values()].filter((p) => entityIds.includes(p.mirrorEntityId!));
    if (applicablePages.length) {
      const rows = await db.select().from(pageRecordValuesTable).where(and(inArray(pageRecordValuesTable.recordId, ids), inArray(pageRecordValuesTable.pageId, applicablePages.map((p) => p.id))));
      for (const row of rows) pageValues.set(`${row.pageId}:${row.recordId}`, row.valuesJson as Record<string, unknown>);
    }
    const relationIds = [...new Set([
      ...entityIds.flatMap((id) => fields.get(id) ?? []),
      ...applicablePages.flatMap((p) => pageFields.get(p.id) ?? []),
    ].filter((f) => f.fieldType === "relation" || f.fieldType === "lookup").flatMap((f) => f.relationConfigJson.relationId ? [f.relationConfigJson.relationId] : []))];
    if (!relationIds.length) break;
    const batch = await db.select().from(recordLinksTable).where(and(inArray(recordLinksTable.relationId, relationIds), or(inArray(recordLinksTable.sourceRecordId, ids), inArray(recordLinksTable.targetRecordId, ids)))).limit(MAX_RECORDS * 10 + 1);
    if (batch.length > MAX_RECORDS * 10) throw new Error("Webhook projection exceeds link limit");
    for (const link of batch) links.set(link.id, link);
    const nextIds = [...new Set(batch.flatMap((l) => [l.sourceRecordId, l.targetRecordId]))].filter((id) => !records.has(id));
    if (nextIds.length + records.size > MAX_RECORDS) throw new Error(`Webhook projection exceeds ${MAX_RECORDS} records`);
    frontier = nextIds.length ? await db.select().from(entityRecordsTable).where(inArray(entityRecordsTable.id, nextIds)) : [];
    for (const row of frontier) records.set(row.id, row);
  }
  if (options.pageId != null && pages.get(options.pageId)?.mirrorEntityId !== entityId) throw new Error("Webhook page is not a mirror of the triggering entity");

  const userIds = new Set<number>();
  for (const row of records.values()) {
    const scan = (defs: Field[], values: Record<string, unknown>) => {
      for (const f of defs) if (f.fieldType === "user") {
        const value = values[f.fieldKey];
        for (const id of Array.isArray(value) ? value : [value]) {
          const numericId = typeof id === "number" || typeof id === "string" ? Number(id) : NaN;
          if (Number.isInteger(numericId) && numericId > 0) userIds.add(numericId);
        }
      }
    };
    scan(fields.get(row.entityId) ?? [], row.valuesJson as Record<string, unknown>);
    for (const p of pages.values()) if (p.mirrorEntityId === row.entityId) scan(pageFields.get(p.id) ?? [], pageValues.get(`${p.id}:${row.id}`) ?? {});
  }
  const userRows = userIds.size ? await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, [...userIds])) : [];
  const users = new Map(userRows.map((u) => [u.id, { id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email }]));
  const formulaOptions = await loadFormulaOptions();
  const scopes = new Map<string, Record<string, unknown>>();
  const recomputeContexts: (() => void)[] = [];
  const scalarProjection = (row: RecordRow, field: Field, pageId?: number, stack = new Set<string>()): unknown => {
    const token = `${row.id}:${pageId ?? ""}:${field.fieldKey}`;
    if (stack.has(token) || stack.size >= MAX_DEPTH) return null;
    const next = new Set(stack).add(token);
    if (field.fieldType === "function") return scopes.get(`${row.id}:${pageId ?? ""}`)?.[pageId == null ? `entity:${row.entityId}.${field.fieldKey}` : `page:${pageId}.${field.fieldKey}`] ?? null;
    if (field.fieldType === "created_at") return row.createdAt.toISOString();
    if (field.fieldType !== "relation" && field.fieldType !== "lookup") return (pageId == null ? row.valuesJson as Record<string, unknown> : pageValues.get(`${pageId}:${row.id}`))?.[field.fieldKey] ?? null;
    const cfg = field.relationConfigJson;
    const relation = cfg.relationId == null ? undefined : relations.get(cfg.relationId);
    if (!relation) return null;
    const source = relation.sourceEntityId === row.entityId;
    const values: unknown[] = [];
    for (const link of links.values()) {
      if (link.relationId !== relation.id || (source ? link.sourceRecordId : link.targetRecordId) !== row.id) continue;
      const target = records.get(source ? link.targetRecordId : link.sourceRecordId);
      if (!target) continue;
      const targetPageId = cfg.relatedPageId ?? undefined;
      const defs = targetPageId == null ? fields.get(target.entityId) : pages.get(targetPageId)?.mirrorEntityId === target.entityId ? pageFields.get(targetPageId) : [];
      const targetField = defs?.find((f) => f.fieldKey === cfg.relatedFieldKey);
      if (targetField) values.push(scalarProjection(target, targetField, targetPageId, next));
    }
    return aggregateLinkedValues("min", values);
  };
  for (const [id, defs] of fields) {
    let rows = [...records.values()].filter((r) => r.entityId === id);
    const entityPages = [...pages.values()].filter((p) => p.mirrorEntityId === id);
    if ([...defs, ...entityPages.flatMap((p) => pageFields.get(p.id) ?? [])].some((f) => f.formulaConfigJson.groupResult?.enabled)) {
      const candidates = await db.select().from(entityRecordsTable).where(and(eq(entityRecordsTable.entityId, id), isNull(entityRecordsTable.archivedAt))).limit(MAX_RECORDS + 1);
      const combined = new Map([...candidates, ...rows].map((r) => [r.id, r]));
      if (combined.size > MAX_RECORDS) throw new Error(`Webhook grouped formulas exceed ${MAX_RECORDS} candidate records`);
      rows = [...combined.values()];
      if (entityPages.length && rows.length) {
        const locals = await db.select().from(pageRecordValuesTable).where(and(inArray(pageRecordValuesTable.pageId, entityPages.map((p) => p.id)), inArray(pageRecordValuesTable.recordId, rows.map((r) => r.id))));
        for (const local of locals) pageValues.set(`${local.pageId}:${local.recordId}`, local.valuesJson as Record<string, unknown>);
      }
    }
    const prepare = async (pageId?: number) => {
      const pdefs = pageId == null ? [] : pageFields.get(pageId) ?? [];
      const withCreatedAt = (values: Record<string, unknown>, schema: Field[], row: RecordRow) => ({
        ...values, ...Object.fromEntries(schema.filter((f) => f.fieldType === "created_at").map((f) => [f.fieldKey, row.createdAt.toISOString()])),
      });
      const rawRows = rows.map((r) => ({ id: r.id, values: withCreatedAt(r.valuesJson as Record<string, unknown>, defs, r) }));
      const locals = new Map(rows.map((r) => [r.id, withCreatedAt(pageValues.get(`${pageId}:${r.id}`) ?? {}, pdefs, r)]));
      const inputs = await mergeLinkedFormulaInputs({
        entityId: id, pageId, rows: rawRows.map((r) => ({ id: r.id, values: {
          ...r.values,
          ...(pageId == null ? {} : locals.get(r.id) ?? {}),
        } })), fields: [...defs, ...pdefs], permissions: systemFormulaPermissions,
      });
      const recompute = () => {
      // The shared linked resolver reads stored target values. Resolve computed
      // legacy lookup operands from this bounded system graph before using the
      // same typed materializers; never coerce target formulas to numbers.
      for (const row of rows) {
        const input = inputs.get(row.id);
        if (!input) continue;
        for (const field of [...defs, ...pdefs]) {
          if (field.fieldType !== "relation" && field.fieldType !== "lookup") continue;
          input[field.fieldKey] = scalarProjection(row, field, "pageId" in field ? field.pageId : undefined);
        }
      }
      let entityComputed = materializeVisibleEntityFormulas({
        entityId: id, rows: rawRows, fields: defs, hidden: new Set(), pageId,
        pageFields: pdefs, pageValues: locals, linkedInputs: inputs, formulaOptions,
      });
      let pageComputed = pageId == null ? new Map<number, Record<string, unknown>>() : materializeVisiblePageFormulas({
        entityId: id, pageId, rows: rawRows.map((r) => ({ id: r.id, entityValues: r.values, pageValues: locals.get(r.id) ?? {} })),
        entityFields: defs, pageFields: pdefs,
        hiddenEntity: new Set(), hiddenPage: new Set(), linkedInputs: inputs, formulaOptions,
      });
      const groupRows = rows.map((r) => ({
        id: r.id, createdAt: r.createdAt, entityValues: entityComputed.get(r.id) ?? {},
        pageValues: pageId == null ? undefined : new Map([[pageId, pageComputed.get(r.id) ?? {}]]),
      }));
      entityComputed = applyFormulaGroupResults(entityComputed, formulaGroupResultWinners(groupRows,
        secureFormulaGroupConfigs({ fields: defs, entityFields: defs, pageFields: pdefs, pageId })));
      pageComputed = applyFormulaGroupResults(pageComputed, formulaGroupResultWinners(groupRows,
        secureFormulaGroupConfigs({ fields: pdefs, entityFields: defs, pageFields: pdefs, pageId })));
      for (const r of rows) {
        scopes.set(`${r.id}:${pageId ?? ""}`, {
          ...Object.fromEntries(Object.entries(entityComputed.get(r.id) ?? {}).map(([key, value]) => [`entity:${id}.${key}`, value])),
          ...Object.fromEntries(Object.entries(pageComputed.get(r.id) ?? {}).map(([key, value]) => [`page:${pageId}.${key}`, value])),
        });
      }
      };
      recomputeContexts.push(recompute);
      recompute();
    };
    await prepare();
    for (const p of pages.values()) if (p.mirrorEntityId === id) await prepare(p.id);
  }
  let stable = false;
  for (let pass = 0; pass <= MAX_DEPTH; pass++) {
    const before = JSON.stringify([...scopes]);
    for (const recompute of recomputeContexts) recompute();
    if (before === JSON.stringify([...scopes])) { stable = true; break; }
  }
  if (!stable) throw new Error("Webhook linked formula cycle or dependency depth limit exceeded");
  const project = (row: RecordRow, field: Field, pageId: number | undefined, stack: Set<string>): Projection => {
    const key = pageId == null ? `entity:${row.entityId}.${field.fieldKey}` : `page:${pageId}.${field.fieldKey}`;
    const token = `${row.id}:${key}`;
    const values = pageId == null ? row.valuesJson as Record<string, unknown> : pageValues.get(`${pageId}:${row.id}`) ?? {};
    const rawValue = field.fieldType === "created_at" ? row.createdAt.toISOString() : field.fieldType === "function" || field.fieldType === "relation" || field.fieldType === "lookup" ? null : values[field.fieldKey] ?? null;
    const result: Projection = { key, fieldKey: field.fieldKey, entityId: row.entityId, pageId: pageId ?? null,
      name: webhookLabel(field.nameJson, language), nameJson: field.nameJson, type: field.fieldType, rawValue,
      resolvedValue: null, displayValue: "" };
    if (stack.has(token) || stack.size > MAX_DEPTH) return { ...result, error: "projection_cycle_or_depth_limit" };
    const next = new Set(stack).add(token);
    let value: unknown = rawValue;
    if (field.fieldType === "function") {
      const contextPage = pageId ?? (row.entityId === entityId ? options.pageId : undefined);
      value = scopes.get(`${row.id}:${contextPage ?? ""}`)?.[key] ?? null;
    } else if (field.fieldType === "user") {
      const resolve = (id: unknown) => id == null ? null : users.get(Number(id)) ?? { id, name: null };
      value = Array.isArray(rawValue) ? rawValue.map(resolve) : resolve(rawValue);
    } else if (field.fieldType === "select" || field.fieldType === "multiselect") {
      const opts = Array.isArray(field.optionsJson) ? field.optionsJson as { value: string; labelJson?: unknown }[] : [];
      const resolve = (id: unknown) => {
        if (id == null) return null;
        const option = opts.find((o) => String(o.value) === String(id));
        return { id, labelJson: option?.labelJson ?? {}, label: webhookLabel(option?.labelJson, language) || String(id) };
      };
      value = Array.isArray(rawValue) ? rawValue.map(resolve) : resolve(rawValue);
    } else if (field.fieldType === "file") {
      value = webhookFile(rawValue, baseUrl);
    } else if (field.fieldType === "relation" || field.fieldType === "lookup") {
      const cfg = field.relationConfigJson;
      const relation = cfg.relationId == null ? undefined : relations.get(cfg.relationId);
      const projected: unknown[] = [];
      if (relation && (relation.sourceEntityId === row.entityId || relation.targetEntityId === row.entityId)) {
        const source = relation.sourceEntityId === row.entityId;
        for (const link of links.values()) {
          if (link.relationId !== relation.id || (source ? link.sourceRecordId : link.targetRecordId) !== row.id) continue;
          const target = records.get(source ? link.targetRecordId : link.sourceRecordId);
          if (!target) continue;
          const targetPage = cfg.relatedPageId ?? undefined;
          const targetDefs = targetPage == null ? fields.get(target.entityId) : pages.get(targetPage)?.mirrorEntityId === target.entityId ? pageFields.get(targetPage) : [];
          const targetField = targetDefs?.find((f) => f.fieldKey === cfg.relatedFieldKey);
          const projection = targetField ? project(target, targetField, targetPage, next) : null;
          projected.push({ relationId: relation.id, linkId: link.id, entityId: target.entityId, recordId: target.id,
            pageId: targetPage ?? null, field: projection, resolvedValue: projection?.resolvedValue ?? null,
            displayValue: projection?.displayValue ?? "", ...(projection ? {} : { error: "missing_projection_field" }) });
        }
      }
      value = projected;
    }
    result.resolvedValue = value;
    result.displayValue = webhookDisplay(value, field, language, formulaOptions.timeZone);
    return result;
  };
  const entityFields = (fields.get(entityId) ?? []).map((f) => project(current, f, undefined, new Set()));
  const localFields = [...pages.values()].filter((p) => p.mirrorEntityId === entityId && (options.pageId == null || p.id === options.pageId))
    .flatMap((p) => (pageFields.get(p.id) ?? []).map((f) => project(current, f, p.id, new Set())));
  // Keep the historical values map; derived relation values retain the old string[] shape.
  const legacyValues = { ...(current.valuesJson as Record<string, unknown>) };
  for (const f of fields.get(entityId) ?? []) if (f.fieldType === "relation" || f.fieldType === "lookup") {
    const cfg = f.relationConfigJson;
    const rel = cfg.relationId == null ? undefined : relations.get(cfg.relationId);
    if (!rel || !cfg.relatedFieldKey || cfg.relatedPageId != null) continue;
    const source = rel.sourceEntityId === entityId;
    legacyValues[f.fieldKey] = [...links.values()]
      .filter((l) => l.relationId === rel.id && (source ? l.sourceRecordId : l.targetRecordId) === recordId)
      .map((l) => (records.get(source ? l.targetRecordId : l.sourceRecordId)?.valuesJson as Record<string, unknown> | undefined)?.[cfg.relatedFieldKey!])
      .filter((v) => v != null && v !== "")
      .map((v) => typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const payload = { entityId, recordId, values: legacyValues, statusId: current.statusId, schemaVersion: 2,
    language, pageId: options.pageId ?? null, fields: [...entityFields, ...localFields] };
  if (Buffer.byteLength(JSON.stringify(payload)) > 2_000_000) throw new Error("Webhook payload exceeds 2 MB");
  return payload;
}