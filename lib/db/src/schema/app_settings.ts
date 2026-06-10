import { pgTable, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Singleton row (id = 1) holding platform branding shown in the sidebar header:
 * multilingual app name + subtitle and an optional uploaded logo (object-storage
 * path, served publicly via /storage/branding-logo). There is intentionally only
 * ever one row.
 */
export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  appNameJson: jsonb("app_name_json").notNull().default({}),
  subtitleJson: jsonb("subtitle_json").notNull().default({}),
  logoObjectPath: text("logo_object_path"),
  // Free-text currency symbol/suffix (e.g. "₽", "$", "€", "₸") used wherever a
  // monetary value is rendered (e.g. dashboard "currency"-format widgets).
  currencySymbol: text("currency_symbol").notNull().default("₽"),
  // Platform-wide default UI language (ru/en/he) used for users who have not yet
  // picked their own language; it is the fallback for the i18n active language.
  defaultLanguage: text("default_language").notNull().default("ru"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;
