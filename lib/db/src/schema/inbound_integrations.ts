import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const INBOUND_DELIVERY_STATUSES = [
  "received",
  "queued",
  "processing",
  "completed",
  "completed_with_warnings",
  "failed",
] as const;
export type InboundDeliveryStatus = (typeof INBOUND_DELIVERY_STATUSES)[number];

export const inboundIntegrationsTable = pgTable("inbound_integrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  userId: integer("user_id").notNull(),
  roleId: integer("role_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  maxBodyBytes: integer("max_body_bytes").notNull().default(1048576),
  publishedMappingVersionId: integer("published_mapping_version_id"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const inboundMappingVersionsTable = pgTable(
  "inbound_mapping_versions",
  {
    id: serial("id").primaryKey(),
    integrationId: integer("integration_id").notNull(),
    version: integer("version").notNull(),
    state: text("state").notNull().default("draft"),
    mappingJson: jsonb("mapping_json").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("inbound_mapping_integration_version").on(t.integrationId, t.version)],
);

export const inboundDeliveriesTable = pgTable(
  "inbound_deliveries",
  {
    id: serial("id").primaryKey(),
    integrationId: integer("integration_id").notNull(),
    eventId: text("event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    mappingVersionId: integer("mapping_version_id"),
    status: text("status").$type<InboundDeliveryStatus>().notNull().default("received"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("inbound_delivery_event").on(t.integrationId, t.eventId),
    index("inbound_delivery_status").on(t.status, t.receivedAt),
  ],
);

export const inboundDeliveryStepLogsTable = pgTable("inbound_delivery_step_logs", {
  id: serial("id").primaryKey(),
  deliveryId: integer("delivery_id").notNull(),
  stepKey: text("step_key").notNull(),
  status: text("status").notNull(),
  action: text("action"),
  targetId: integer("target_id"),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inboundExternalObjectMappingsTable = pgTable(
  "inbound_external_object_mappings",
  {
    id: serial("id").primaryKey(),
    integrationId: integer("integration_id").notNull(),
    objectType: text("object_type").notNull(),
    externalId: text("external_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: integer("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("inbound_external_object_key").on(t.integrationId, t.objectType, t.externalId),
    index("inbound_external_target").on(t.integrationId, t.targetKind, t.targetId),
  ],
);