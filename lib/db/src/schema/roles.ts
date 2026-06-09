import { pgTable, serial, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Row-visibility scope for a role's records on an entity. */
export type RecordScope = "all" | "own";

/** Per-entity record CRUD rights (keyed by entityId in RolePermissions.records). */
export interface RecordPermission {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  /**
   * Row scope: "all" (default) sees every row; "own" restricts to rows the
   * current user owns — i.e. where any of `scopeFieldKeys` (user-type fields)
   * equals the requester's id. Missing = "all" for backward compatibility.
   */
  scope?: RecordScope;
  /** User-type field keys that designate ownership when scope === "own". */
  scopeFieldKeys?: string[];
}

/** Admin-builder capability areas. */
export interface RoleAdminCaps {
  pages: boolean;
  entities: boolean;
  roles: boolean;
  users: boolean;
  translations: boolean;
  /** View the system event stream (Event System). */
  events: boolean;
  /** Manage the module registry (Modules Architecture). */
  modules: boolean;
  /** Manage the Google Drive connection used by file fields. */
  googleDrive: boolean;
  /** Manage platform branding / general settings (app name, subtitle, logo). */
  settings: boolean;
}

/**
 * Permission-map key for a mirror page's record-rights override.
 *
 * `RolePermissions.records` is keyed primarily by stringified entityId, but a
 * mirror page can carry its OWN record CRUD override under `mirror:<pageId>`.
 * When present it replaces the source entity's CRUD rights for record actions
 * taken through that mirror page (create/update/delete/view); when absent the
 * mirror page inherits the entity's rights (backward compatible). Only the four
 * CRUD booleans are meaningful for a mirror override — row scope (all/own) is
 * always resolved from the source entity, never overridden per page.
 */
export const mirrorPermKey = (pageId: number): string => `mirror:${pageId}`;

/** Structured RBAC permission spec stored on each role. */
export interface RolePermissions {
  /** Bypasses all checks (the seeded admin role). */
  superAdmin: boolean;
  /** Capability to manage each admin builder. */
  admin: RoleAdminCaps;
  /** Page ids visible in the sidebar / accessible (content pages). */
  pageIds: number[];
  /**
   * Record CRUD rights. Keyed by stringified entityId for entity-level rights,
   * and optionally by `mirror:<pageId>` (see {@link mirrorPermKey}) for a
   * per-mirror-page override.
   */
  records: Record<string, RecordPermission>;
}

/** Default permissions for new/existing roles: no access until granted. */
export const NO_ACCESS_PERMS: RolePermissions = {
  superAdmin: false,
  admin: { pages: false, entities: false, roles: false, users: false, translations: false, events: false, modules: false, googleDrive: false, settings: false },
  pageIds: [],
  records: {},
};

export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  nameJson: jsonb("name_json").notNull().default({}),
  descriptionJson: jsonb("description_json").default({}),
  permissionsJson: jsonb("permissions_json").$type<RolePermissions>().notNull().default(NO_ACCESS_PERMS),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRoleSchema = createInsertSchema(rolesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;
