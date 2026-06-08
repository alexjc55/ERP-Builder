import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Recycle bin for LOCAL (object-storage) files removed from records. A row is
 * created when a record is deleted or a file field is cleared/replaced; the
 * physical object is only removed when the entry is purged from the trash.
 * Google Drive files are never tracked here (we never delete from Drive).
 * Name snapshots (entity/field) are stored so the origin stays readable even if
 * the source entity/field is later deleted.
 */
export const deletedFilesTable = pgTable("deleted_files", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id"),
  entityNameJson: jsonb("entity_name_json"),
  recordId: integer("record_id"),
  fieldKey: text("field_key").notNull(),
  fieldNameJson: jsonb("field_name_json"),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  contentType: text("content_type"),
  // "record_deleted" | "field_cleared" | "field_replaced"
  reason: text("reason").notNull(),
  deletedBy: integer("deleted_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDeletedFileSchema = createInsertSchema(deletedFilesTable).omit({ id: true, deletedAt: true });
export type InsertDeletedFile = z.infer<typeof insertDeletedFileSchema>;
export type DeletedFile = typeof deletedFilesTable.$inferSelect;
