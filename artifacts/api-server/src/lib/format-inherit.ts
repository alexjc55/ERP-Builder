import {
  db,
  entityFieldsTable,
  entityStatusesTable,
  pageFieldsTable,
  type FieldFormatRule,
  type FormatInheritSource,
  type FieldPermissions,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Format-inheritance resolution. A field whose value is COPIED from elsewhere
 * by automations (e.g. an order's «Общий статус» filled from an изделие's
 * status fields or record status) can declare `formatInheritJson` sources.
 * At read time the sources are resolved into plain FieldFormatRule[] and
 * returned as the response-only `inheritedFormatRulesJson`, which clients
 * apply AFTER the field's own formatRulesJson (first match wins, so own rules
 * take precedence; no match anywhere = no formatting).
 *
 * Visibility decision (explicit, user-confirmed): inherited rules follow the
 * TARGET field's visibility, not the source's. Whoever can see the target
 * field sees its inherited coloring — even when a pageField source lives on a
 * page the requester cannot open. Rationale: the VALUES matched by these rules
 * are copied into the target field by automations anyway, so hiding the colors
 * reveals nothing extra and only makes the field render inconsistently between
 * roles. Only formatting config (operators/literals/colors) is exposed — never
 * record data.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Validate a client-supplied formatInheritJson value. Returns an error message or null. */
export function validateFormatInherit(input: unknown): string | null {
  if (!Array.isArray(input)) return "formatInheritJson must be an array";
  if (input.length > 10) return "Не более 10 источников форматирования";
  for (const s of input) {
    if (!s || typeof s !== "object") return "Некорректный источник форматирования";
    const src = s as Record<string, unknown>;
    if (src.kind === "status") {
      if (!Number.isInteger(src.entityId)) return "Источник-статус: не указана сущность";
    } else if (src.kind === "field") {
      if (!Number.isInteger(src.entityId)) return "Источник-поле: не указана сущность";
      if (typeof src.fieldKey !== "string" || src.fieldKey === "") return "Источник-поле: не указано поле";
    } else if (src.kind === "pageField") {
      if (!Number.isInteger(src.pageId)) return "Источник-поле страницы: не указана страница";
      if (typeof src.fieldKey !== "string" || src.fieldKey === "") return "Источник-поле страницы: не указано поле";
    } else {
      return "Некорректный тип источника форматирования";
    }
  }
  return null;
}

/** Text color with enough contrast against a light `${color}20` background: the status color itself. */
function statusRulesFor(nameJson: unknown, color: string): FieldFormatRule[] {
  const labels =
    nameJson && typeof nameJson === "object"
      ? [...new Set(Object.values(nameJson as Record<string, unknown>).filter((v): v is string => typeof v === "string" && v.trim() !== ""))]
      : [];
  const safeColor = HEX_RE.test(color) ? color : "#6b7280";
  return labels.map((label) => ({
    operator: "equals" as const,
    value: label,
    cellColor: `${safeColor}20`,
    textColor: safeColor,
  }));
}

/**
 * Bulk-fetch everything the given sources need (one query for source fields,
 * one for statuses), then return a synchronous resolver. Order matters:
 * sources are resolved in the configured order; within a "status" source,
 * statuses follow their sortOrder.
 */
async function buildResolver(allSources: FormatInheritSource[]): Promise<(sources: FormatInheritSource[]) => FieldFormatRule[]> {
  const fieldSrcs = allSources.filter((s): s is Extract<FormatInheritSource, { kind: "field" }> => s.kind === "field");
  const pageFieldSrcs = allSources.filter((s): s is Extract<FormatInheritSource, { kind: "pageField" }> => s.kind === "pageField");
  const statusEntityIds = [...new Set(allSources.filter((s) => s.kind === "status").map((s) => s.entityId))];

  const [srcFields, srcStatuses, srcPageFields] = await Promise.all([
    fieldSrcs.length
      ? db
          .select({
            entityId: entityFieldsTable.entityId,
            fieldKey: entityFieldsTable.fieldKey,
            formatRulesJson: entityFieldsTable.formatRulesJson,
          })
          .from(entityFieldsTable)
          .where(
            and(
              inArray(entityFieldsTable.entityId, [...new Set(fieldSrcs.map((s) => s.entityId))]),
              inArray(entityFieldsTable.fieldKey, [...new Set(fieldSrcs.map((s) => s.fieldKey))]),
              eq(entityFieldsTable.isActive, true),
            ),
          )
      : Promise.resolve([] as { entityId: number; fieldKey: string; formatRulesJson: unknown }[]),
    statusEntityIds.length
      ? db
          .select({
            entityId: entityStatusesTable.entityId,
            nameJson: entityStatusesTable.nameJson,
            color: entityStatusesTable.color,
            sortOrder: entityStatusesTable.sortOrder,
          })
          .from(entityStatusesTable)
          .where(and(inArray(entityStatusesTable.entityId, statusEntityIds), eq(entityStatusesTable.isActive, true)))
      : Promise.resolve([] as { entityId: number; nameJson: unknown; color: string; sortOrder: number }[]),
    pageFieldSrcs.length
      ? db
          .select({
            pageId: pageFieldsTable.pageId,
            fieldKey: pageFieldsTable.fieldKey,
            formatRulesJson: pageFieldsTable.formatRulesJson,
          })
          .from(pageFieldsTable)
          .where(
            and(
              inArray(pageFieldsTable.pageId, [...new Set(pageFieldSrcs.map((s) => s.pageId))]),
              inArray(pageFieldsTable.fieldKey, [...new Set(pageFieldSrcs.map((s) => s.fieldKey))]),
              eq(pageFieldsTable.isActive, true),
            ),
          )
      : Promise.resolve([] as { pageId: number; fieldKey: string; formatRulesJson: unknown }[]),
  ]);

  return (sources: FormatInheritSource[]): FieldFormatRule[] => {
    const rules: FieldFormatRule[] = [];
    for (const src of sources) {
      if (src.kind === "field") {
        const f = srcFields.find((sf) => sf.entityId === src.entityId && sf.fieldKey === src.fieldKey);
        if (f && Array.isArray(f.formatRulesJson)) rules.push(...(f.formatRulesJson as FieldFormatRule[]));
      } else if (src.kind === "pageField") {
        const pf = srcPageFields.find((sf) => sf.pageId === src.pageId && sf.fieldKey === src.fieldKey);
        if (pf && Array.isArray(pf.formatRulesJson)) rules.push(...(pf.formatRulesJson as FieldFormatRule[]));
      } else {
        const statuses = srcStatuses
          .filter((st) => st.entityId === src.entityId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        for (const st of statuses) rules.push(...statusRulesFor(st.nameJson, st.color));
      }
    }
    return rules;
  };
}

/**
 * Attach `inheritedFormatRulesJson` to a list of serialized entity fields.
 * All sources across the whole list are prefetched in TWO queries (one for
 * source fields, one for statuses) — no per-field query fan-out. Fields
 * without sources get [].
 */
export async function withInheritedFormatRules<
  T extends { formatInheritJson: unknown },
>(fields: T[]): Promise<(T & { inheritedFormatRulesJson: FieldFormatRule[] })[]> {
  const sourcesOf = (f: T): FormatInheritSource[] =>
    (Array.isArray(f.formatInheritJson) ? f.formatInheritJson : []) as FormatInheritSource[];
  const allSources = fields.flatMap(sourcesOf);
  if (allSources.length === 0) {
    return fields.map((f) => ({ ...f, inheritedFormatRulesJson: [] as FieldFormatRule[] }));
  }
  const resolve = await buildResolver(allSources);
  return fields.map((f) => ({ ...f, inheritedFormatRulesJson: resolve(sourcesOf(f)) }));
}
