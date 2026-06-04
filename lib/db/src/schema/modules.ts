import { pgTable, serial, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const modulesTable = pgTable("modules", {
  id: serial("id").primaryKey(),
  moduleKey: text("module_key").notNull().unique(),
  nameJson: jsonb("name_json").notNull().default({}),
  version: text("version").notNull().default("1.0.0"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  settingsJson: jsonb("settings_json").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertModuleSchema = createInsertSchema(modulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertModule = z.infer<typeof insertModuleSchema>;
export type Module = typeof modulesTable.$inferSelect;
