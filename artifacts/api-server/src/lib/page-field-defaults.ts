import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pagesTable, pageFieldsTable, pageRecordValuesTable } from "@workspace/db";
import type { Logger } from "pino";
import { emitEvent, EVENT_PAGE_FIELD_SAVED } from "./events";

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

    const changed = await db.transaction(async (tx) => {
      const results: { pageId: number; version: number; changedPageFieldKeys: string[] }[] = [];
      for (const [pageId, defaults] of [...defaultsByPage.entries()].sort((a, b) => a[0] - b[0])) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock((${pageId}::bigint << 32) | ${recordId}::bigint)`,
        );
        const [existing] = await tx
          .select({ id: pageRecordValuesTable.id, valuesJson: pageRecordValuesTable.valuesJson })
          .from(pageRecordValuesTable)
          .where(and(
            eq(pageRecordValuesTable.pageId, pageId),
            eq(pageRecordValuesTable.recordId, recordId),
          ))
          .for("update");
        const stored = (existing?.valuesJson as Record<string, unknown> | undefined) ?? {};
        const merged = { ...stored };
        const changedPageFieldKeys: string[] = [];
        for (const [fieldKey, value] of Object.entries(defaults)) {
          const current = merged[fieldKey];
          if (current === undefined || current === null || current === "") {
            merged[fieldKey] = value;
            changedPageFieldKeys.push(fieldKey);
          }
        }
        if (changedPageFieldKeys.length === 0) continue;
        const [written] = existing
          ? await tx.update(pageRecordValuesTable)
            .set({ valuesJson: merged })
            .where(eq(pageRecordValuesTable.id, existing.id))
            .returning({ version: pageRecordValuesTable.version })
          : await tx.insert(pageRecordValuesTable)
            .values({ pageId, recordId, valuesJson: merged })
            .returning({ version: pageRecordValuesTable.version });
        if (written) results.push({ pageId, version: written.version, changedPageFieldKeys });
      }
      return results;
    });
    for (const result of changed) {
      await emitEvent({
        eventName: EVENT_PAGE_FIELD_SAVED,
        entityId,
        recordId,
        payload: {
          pageId: result.pageId,
          changedPageFieldKeys: result.changedPageFieldKeys,
          version: result.version,
        },
      }, log);
    }
  } catch (err) {
    log.error({ entityId, recordId, err }, "applyPageFieldDefaults failed (record creation unaffected)");
  }
}
