import { and, eq, inArray } from "drizzle-orm";
import { db, pagesTable, pageFieldsTable, pageRecordValuesTable } from "@workspace/db";
import type { Logger } from "pino";

/**
 * Page-field types whose default is a stored scalar. function/relation/lookup
 * have no stored value; file/user defaults make no sense as free text.
 */
const DEFAULTABLE_TYPES = new Set(["text", "textarea", "number", "percent", "select", "boolean", "date", "datetime"]);

/** Coerce the stored (string) default into the value shape the field stores. */
function coerceDefault(fieldType: string, raw: string): unknown | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  if (fieldType === "number" || fieldType === "percent") {
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  if (fieldType === "boolean") {
    if (s === "true") return true;
    if (s === "false") return false;
    return undefined;
  }
  return s;
}

/**
 * CREATE-TIME page-field defaults: when a record of `entityId` is created (on
 * ANY page/path), persist every mirror page's page-local field default into
 * `page_record_values` so the record shows the default on every mirror page,
 * filters see a real value (not "(Пусто)"), and automations/formulas read it.
 *
 * Only fills fields with a non-empty coercible default; never touches existing
 * page value rows' other keys (for a brand-new record there are none, but the
 * merge keeps this safe if a page value was written first, e.g. by the creating
 * page's own form — an explicitly stored value always wins over the default).
 *
 * Best-effort by design: a failure must never roll back or block the record
 * creation itself — it only logs.
 */
export async function applyPageFieldDefaults(entityId: number, recordId: number, log: Logger): Promise<void> {
  try {
    const pages = await db
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .where(eq(pagesTable.mirrorEntityId, entityId));
    if (pages.length === 0) return;
    const pageIds = pages.map((p) => p.id);
    const pfs = await db
      .select()
      .from(pageFieldsTable)
      .where(and(inArray(pageFieldsTable.pageId, pageIds), eq(pageFieldsTable.isActive, true)));

    // pageId -> { fieldKey: defaultValue } of applicable defaults
    const defaultsByPage = new Map<number, Record<string, unknown>>();
    for (const pf of pfs) {
      if (!DEFAULTABLE_TYPES.has(pf.fieldType)) continue;
      const raw = (pf.defaultValue ?? "").trim();
      if (!raw) continue;
      const v = coerceDefault(pf.fieldType, raw);
      if (v === undefined) continue;
      const m = defaultsByPage.get(pf.pageId) ?? {};
      m[pf.fieldKey] = v;
      defaultsByPage.set(pf.pageId, m);
    }
    if (defaultsByPage.size === 0) return;

    for (const [pageId, defaults] of defaultsByPage) {
      const [existing] = await db
        .select({ id: pageRecordValuesTable.id, valuesJson: pageRecordValuesTable.valuesJson })
        .from(pageRecordValuesTable)
        .where(and(eq(pageRecordValuesTable.pageId, pageId), eq(pageRecordValuesTable.recordId, recordId)));
      if (existing) {
        // Explicit values win; only fill keys with no stored value.
        const stored = (existing.valuesJson as Record<string, unknown>) ?? {};
        const merged = { ...stored };
        let changed = false;
        for (const [k, v] of Object.entries(defaults)) {
          const cur = merged[k];
          if (cur === undefined || cur === null || cur === "") {
            merged[k] = v;
            changed = true;
          }
        }
        if (changed) {
          await db
            .update(pageRecordValuesTable)
            .set({ valuesJson: merged })
            .where(eq(pageRecordValuesTable.id, existing.id));
        }
      } else {
        await db.insert(pageRecordValuesTable).values({ pageId, recordId, valuesJson: defaults });
      }
    }
  } catch (err) {
    log.error({ entityId, recordId, err }, "applyPageFieldDefaults failed (record creation unaffected)");
  }
}
