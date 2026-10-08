import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const loginThrottleTable = pgTable("login_throttle", {
  bucket: text("bucket").primaryKey(),
  hits: integer("hits").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const insertLoginThrottleSchema = createInsertSchema(loginThrottleTable);
export type LoginThrottle = typeof loginThrottleTable.$inferSelect;
