import { randomUUID } from "node:crypto";
import { db, pagesTable, entitiesTable, pageFieldsTable, dashboardWidgetsTable,
  viewsTable, cardTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAdminPath } from "./system-pages";

// Only page references are remapped. Entity/role/record identities stay shared.
function remapSelf<T>(value: T, from: number, to: number): T {
  if (Array.isArray(value)) return value.map(v => remapSelf(v, from, to)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) =>
      [key, (key === "pageId" || key === "targetPageId" || key === "sourcePageId") && v === from ? to : remapSelf(v, from, to)])) as T;
  }
  return value;
}

export async function duplicatePage(id: number) {
  return db.transaction(async tx => {
    const [source] = await tx.select().from(pagesTable).where(eq(pagesTable.id, id)).for("update");
    if (!source) return { status: 404 as const, error: "Page not found" };
    const [bound] = await tx.select({ id: entitiesTable.id }).from(entitiesTable).where(eq(entitiesTable.pageId, id));
    if (source.isSystem || isAdminPath(source.path) || bound) {
      return { status: 400 as const, error: "System and entity main pages cannot be copied" };
    }
    const { id: _id, createdAt: _created, updatedAt: _updated, ...settings } = source;
    const names = source.nameJson as Record<string, string>;
    const nameJson = Object.fromEntries(Object.entries(names).map(([lang, name]) =>
      [lang, `${name} (${lang === "he" ? "עותק" : lang === "en" ? "copy" : "копия"})`]));
    const [copy] = await tx.insert(pagesTable).values({
      ...settings, nameJson, path: `/page-copy-${randomUUID()}`, isSystem: false,
    }).returning();
    // New rows get new identities and timestamps; no page_record_values or role
    // grants are copied. All configuration either commits together or rolls back.
    const fields = await tx.select().from(pageFieldsTable).where(eq(pageFieldsTable.pageId, id));
    for (const { id: _fieldId, createdAt: _fc, updatedAt: _fu, ...field } of fields) {
      await tx.insert(pageFieldsTable).values(remapSelf({ ...field, pageId: copy.id }, id, copy.id));
    }
    const views = await tx.select().from(viewsTable).where(eq(viewsTable.targetPageId, id));
    const viewIds = new Map<number, number>();
    for (const { id: viewId, createdAt: _vc, updatedAt: _vu, ...view } of views) {
      const [created] = await tx.insert(viewsTable).values(remapSelf({
        ...view, viewKey: `copy_${randomUUID()}`, targetPageId: copy.id,
      }, id, copy.id)).returning();
      viewIds.set(viewId, created.id);
    }
    const widgets = await tx.select().from(dashboardWidgetsTable).where(eq(dashboardWidgetsTable.pageId, id));
    for (const { id: _widgetId, createdAt: _wc, updatedAt: _wu, ...widget } of widgets) {
      await tx.insert(dashboardWidgetsTable).values(remapSelf({ ...widget, pageId: copy.id }, id, copy.id));
    }
    const cards = await tx.select().from(cardTemplatesTable).where(eq(cardTemplatesTable.pageId, id));
    for (const { id: _cardId, createdAt: _cc, updatedAt: _cu, ...card } of cards) {
      await tx.insert(cardTemplatesTable).values(remapSelf({ ...card, pageId: copy.id }, id, copy.id));
    }
    const pivot = remapSelf(copy.pivotConfigJson, id, copy.id);
    if (pivot?.viewId && viewIds.has(pivot.viewId)) pivot.viewId = viewIds.get(pivot.viewId)!;
    const [result] = await tx.update(pagesTable).set({ pivotConfigJson: pivot })
      .where(eq(pagesTable.id, copy.id)).returning();
    return { status: 201 as const, page: { ...result, children: [] } };
  }, { isolationLevel: "repeatable read" });
}
