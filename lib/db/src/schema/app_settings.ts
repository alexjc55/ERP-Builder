import { sql } from "drizzle-orm";
import { pgTable, integer, text, jsonb, timestamp, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Singleton row (id = 1) holding platform branding shown in the sidebar header:
 * multilingual app name + subtitle and an optional uploaded logo (object-storage
 * path, served publicly via /storage/branding-logo). There is intentionally only
 * ever one row.
 */
export const appSettingsTable = pgTable(
  "app_settings",
  {
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
    // IANA time-zone identifier used by calendar-relative formulas such as
    // today(), daysSince() and daysUntil().
    timeZone: text("time_zone").notNull().default("Asia/Jerusalem"),
    // ISO weekdays (Monday=1 ... Sunday=7) counted by workingDaysBetween().
    workingDays: integer("working_days")
      .array()
      .notNull()
      .default(sql`ARRAY[7,1,2,3,4]::integer[]`),
    // ISO weekday used as the organization-wide first day of a calendar week.
    firstDayOfWeek: integer("first_day_of_week").notNull().default(7),
    // Global visual style of the records data table: "plain" (no striping, light
    // header — the original look), "striped" (alternating row colours), or
    // "striped_bold" (alternating rows + a more pronounced header). Cosmetic only.
    tableStyle: text("table_style").notNull().default("plain"),
    // Optional custom hex colour (e.g. "#e0f2fe") for the alternating (striped)
    // rows; null falls back to the built-in subtle grey. Cosmetic only.
    tableStripeColor: text("table_stripe_color"),
    // Optional custom hex colour for the records-table header row background;
    // null falls back to the built-in grey header. Cosmetic only.
    tableHeaderColor: text("table_header_color"),
    // Optional custom hex colour for the records-table divider (grid) lines;
    // null falls back to the built-in light border. Cosmetic only.
    tableBorderColor: text("table_border_color"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "app_settings_working_days_valid",
      sql`cardinality(${table.workingDays}) between 1 and 7 and ${table.workingDays} <@ ARRAY[1,2,3,4,5,6,7]::integer[]`,
    ),
    check(
      "app_settings_first_day_of_week_valid",
      sql`${table.firstDayOfWeek} between 1 and 7`,
    ),
  ],
);

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;
