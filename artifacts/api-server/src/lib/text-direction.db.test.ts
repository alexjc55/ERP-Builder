import assert from "node:assert/strict";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  appSettingsTable,
  pagesTable,
  entitiesTable,
  entityFieldsTable,
  pageFieldsTable,
} from "@workspace/db";
import {
  UpdateSettingsBody,
  UpdatePageBody,
  UpdateFieldBody,
  UpdatePageFieldBody,
} from "@workspace/api-zod";

after(async () => { await pool.end(); });

// All fixture changes roll back, including failures; explicit negative IDs avoid
// advancing production-like serial sequences. The singleton id=1 is never used.
test("nullable text direction persists independently at all four metadata levels", async () => {
  const rollback = new Error("rollback text-direction fixtures");
  await assert.rejects(db.transaction(async (tx) => {
    const id = -1900000001;
    await tx.insert(entitiesTable).values({ id, entityKey: "__text_direction_transaction_test", nameJson: {} });
    const [settings] = await tx.insert(appSettingsTable).values({ id }).returning();
    const [page] = await tx.insert(pagesTable).values({ id, mirrorEntityId: id }).returning();
    const [field] = await tx.insert(entityFieldsTable).values({ id, entityId: id, fieldKey: "direction" }).returning();
    const [pageField] = await tx.insert(pageFieldsTable).values({ id, pageId: id, fieldKey: "direction" }).returning();
    for (const row of [settings, page, field, pageField]) assert.equal(row!.textDirection, null);

    // Exercise generated body validation -> typed update -> persisted read.
    for (const direction of ["rtl", "ltr", null] as const) {
      const [s] = await tx.update(appSettingsTable).set(UpdateSettingsBody.parse({ textDirection: direction })).where(eq(appSettingsTable.id, id)).returning();
      const [p] = await tx.update(pagesTable).set(UpdatePageBody.parse({ textDirection: direction })).where(eq(pagesTable.id, id)).returning();
      const [f] = await tx.update(entityFieldsTable).set({ textDirection: UpdateFieldBody.parse({ textDirection: direction }).textDirection }).where(eq(entityFieldsTable.id, id)).returning();
      const [pf] = await tx.update(pageFieldsTable).set({ textDirection: UpdatePageFieldBody.parse({ textDirection: direction }).textDirection }).where(eq(pageFieldsTable.id, id)).returning();
      for (const row of [s, p, f, pf]) assert.equal(row!.textDirection, direction);
    }

    await tx.update(appSettingsTable).set({ textDirection: "rtl" }).where(eq(appSettingsTable.id, id));
    await tx.update(pagesTable).set({ textDirection: "ltr" }).where(eq(pagesTable.id, id));
    await tx.update(entityFieldsTable).set({ textDirection: "rtl" }).where(eq(entityFieldsTable.id, id));
    await tx.update(pageFieldsTable).set({ textDirection: "ltr" }).where(eq(pageFieldsTable.id, id));
    // A different property update cannot clear an omitted direction override.
    const [s] = await tx.update(appSettingsTable).set(UpdateSettingsBody.parse({ currencySymbol: "$" })).where(eq(appSettingsTable.id, id)).returning();
    const [p] = await tx.update(pagesTable).set(UpdatePageBody.parse({ icon: "file" })).where(eq(pagesTable.id, id)).returning();
    const [f] = await tx.update(entityFieldsTable).set({ nameJson: {} }).where(eq(entityFieldsTable.id, id)).returning();
    const [pf] = await tx.update(pageFieldsTable).set({ nameJson: {} }).where(eq(pageFieldsTable.id, id)).returning();
    assert.deepEqual([s!.textDirection, p!.textDirection, f!.textDirection, pf!.textDirection], ["rtl", "ltr", "rtl", "ltr"]);
    throw rollback;
  }), (error) => error === rollback);
});

test("database enum rejects invalid direction independently of API validation", async () => {
  for (const table of [appSettingsTable, pagesTable, entityFieldsTable, pageFieldsTable]) {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.update(table).set({ textDirection: "auto" as "ltr" }).where(eq(table.id, -1900000001));
    }), (error: unknown) => {
      const cause = (error as { cause?: { code?: string } }).cause;
      return cause?.code === "22P02";
    });
  }
});