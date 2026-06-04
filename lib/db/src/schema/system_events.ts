import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemEventsTable = pgTable("system_events", {
  id: serial("id").primaryKey(),
  eventName: text("event_name").notNull(),
  entityId: integer("entity_id"),
  recordId: integer("record_id"),
  payloadJson: jsonb("payload_json").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSystemEventSchema = createInsertSchema(systemEventsTable).omit({ id: true, createdAt: true });
export type InsertSystemEvent = z.infer<typeof insertSystemEventSchema>;
export type SystemEvent = typeof systemEventsTable.$inferSelect;
