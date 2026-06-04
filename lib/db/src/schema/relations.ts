import { pgTable, serial, jsonb, text, integer, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { entityRecordsTable } from "./records";

export const RELATION_TYPES = ["one_to_one", "one_to_many", "many_to_one", "many_to_many"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const relationsTable = pgTable(
  "relations",
  {
    id: serial("id").primaryKey(),
    sourceEntityId: integer("source_entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    targetEntityId: integer("target_entity_id")
      .notNull()
      .references(() => entitiesTable.id, { onDelete: "cascade" }),
    relationKey: text("relation_key").notNull(),
    relationType: text("relation_type").notNull().default("one_to_many"),
    nameJson: jsonb("name_json").notNull().default({}),
    inverseNameJson: jsonb("inverse_name_json").notNull().default({}),
    settingsJson: jsonb("settings_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("relation_source_key_unique").on(t.sourceEntityId, t.relationKey)],
);

export const recordLinksTable = pgTable(
  "record_links",
  {
    id: serial("id").primaryKey(),
    relationId: integer("relation_id")
      .notNull()
      .references(() => relationsTable.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    sourceRecordId: integer("source_record_id")
      .notNull()
      .references(() => entityRecordsTable.id, { onDelete: "cascade" }),
    targetRecordId: integer("target_record_id")
      .notNull()
      .references(() => entityRecordsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("record_link_unique").on(t.relationId, t.sourceRecordId, t.targetRecordId),
    uniqueIndex("record_link_source_one")
      .on(t.relationId, t.sourceRecordId)
      .where(sql`${t.relationType} in ('one_to_one','many_to_one')`),
    uniqueIndex("record_link_target_one")
      .on(t.relationId, t.targetRecordId)
      .where(sql`${t.relationType} in ('one_to_one','one_to_many')`),
  ],
);

export const insertRelationSchema = createInsertSchema(relationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRelation = z.infer<typeof insertRelationSchema>;
export type Relation = typeof relationsTable.$inferSelect;

export const insertRecordLinkSchema = createInsertSchema(recordLinksTable).omit({ id: true, createdAt: true });
export type InsertRecordLink = z.infer<typeof insertRecordLinkSchema>;
export type RecordLink = typeof recordLinksTable.$inferSelect;
