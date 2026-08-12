import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Capability mask for an AI agent key. The mask NARROWS the linked role's
 * permissions at the HTTP-method level (defense-in-depth, mirroring the guest
 * read-only guard): it can never widen what the role allows.
 *  - full: identical to the role (no method restriction)
 *  - read: GET + POST records/query only
 *  - read_edit: + PUT/PATCH
 *  - read_edit_create: + POST
 *  - read_edit_create_delete: + DELETE (method-wise everything, still role-bounded)
 */
export const AI_AGENT_MASKS = [
  "full",
  "read",
  "read_edit",
  "read_edit_create",
  "read_edit_create_delete",
] as const;
export type AiAgentMask = (typeof AI_AGENT_MASKS)[number];

/**
 * AI agents: machine accounts for external LLM agents (e.g. ChatGPT Actions)
 * calling the ERP API with a long-lived key. Each agent is backed by a
 * passwordless user account (like guest links) so RBAC, own-scope and audit
 * attribution work through the standard user pipeline. The raw key is shown
 * once; only its SHA-256 hash is stored.
 */
export const aiAgentsTable = pgTable("ai_agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** Backing passwordless user account (cannot log in; carries roleId, authorship, audit). */
  userId: integer("user_id").notNull(),
  roleId: integer("role_id").notNull(),
  /**
   * Optional "act as this user": when set, agent requests run under THIS
   * user's identity (their full role set, own-scope, audit attribution)
   * instead of the backing account. Never a superAdmin, never another
   * agent-backed account (validated in the route). Null = act as backing user.
   */
  actsAsUserId: integer("acts_as_user_id"),
  capabilityMask: text("capability_mask").notNull().default("read"),
  tokenHash: text("token_hash").notNull().unique(),
  /** First characters of the key, for display ("agk_ab12…"). */
  tokenPrefix: text("token_prefix").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiAgentSchema = createInsertSchema(aiAgentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiAgent = z.infer<typeof insertAiAgentSchema>;
export type AiAgent = typeof aiAgentsTable.$inferSelect;
