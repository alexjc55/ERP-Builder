import { pgTable, serial, jsonb, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pagesTable } from "./pages";
import { entityRecordsTable } from "./records";

/**
 * Per-record values for page-local fields (see `page_fields`). Stored separately
 * from `entity_records.valuesJson` so page-local columns never pollute the
 * mirrored entity's own data. One row per (pageId, recordId); `valuesJson` is a
 * `fieldKey -> value` map over that page's page-local fields.
 */
export const pageRecordValuesTable = pgTable(
  "page_record_values",
  {
    id: serial("id").primaryKey(),
    pageId: integer("page_id")
      .notNull()
      .references(() => pagesTable.id, { onDelete: "cascade" }),
    recordId: integer("record_id")
      .notNull()
      .references(() => entityRecordsTable.id, { onDelete: "cascade" }),
    valuesJson: jsonb("values_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("page_record_value_unique").on(t.pageId, t.recordId)],
);

export const insertPageRecordValueSchema = createInsertSchema(pageRecordValuesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPageRecordValue = z.infer<typeof insertPageRecordValueSchema>;
export type PageRecordValue = typeof pageRecordValuesTable.$inferSelect;
