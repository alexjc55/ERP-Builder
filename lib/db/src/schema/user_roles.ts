import { pgTable, integer, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { rolesTable } from "./roles";

/**
 * Join table assigning roles to users (many-to-many). A user always also has a
 * PRIMARY role on `users.roleId` (used by the JWT, display, impersonation and
 * guest flows); this table holds the full set of roles, including the primary.
 * Effective permissions are the most-permissive union across all of a user's
 * roles (see the permission resolver).
 */
export const userRolesTable = pgTable(
  "user_roles",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export type UserRole = typeof userRolesTable.$inferSelect;
