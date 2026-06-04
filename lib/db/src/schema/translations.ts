import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const translationsTable = pgTable("translations", {
  id: serial("id").primaryKey(),
  translationKey: text("translation_key").notNull().unique(),
  translationsJson: jsonb("translations_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTranslationSchema = createInsertSchema(translationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTranslation = z.infer<typeof insertTranslationSchema>;
export type Translation = typeof translationsTable.$inferSelect;
