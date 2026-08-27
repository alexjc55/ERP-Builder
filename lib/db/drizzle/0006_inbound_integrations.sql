CREATE TABLE "inbound_integrations" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "role_id" integer NOT NULL REFERENCES "roles"("id"),
  "token_hash" text NOT NULL UNIQUE,
  "token_prefix" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "max_body_bytes" integer DEFAULT 1048576 NOT NULL,
  "published_mapping_version_id" integer,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "inbound_mapping_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "integration_id" integer NOT NULL REFERENCES "inbound_integrations"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "state" text DEFAULT 'draft' NOT NULL,
  "mapping_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone
);
CREATE UNIQUE INDEX "inbound_mapping_integration_version" ON "inbound_mapping_versions" ("integration_id","version");
ALTER TABLE "inbound_integrations" ADD CONSTRAINT "inbound_published_mapping_fk"
  FOREIGN KEY ("published_mapping_version_id") REFERENCES "inbound_mapping_versions"("id") ON DELETE SET NULL;
CREATE TABLE "inbound_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "integration_id" integer NOT NULL REFERENCES "inbound_integrations"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL,
  "payload_hash" text NOT NULL,
  "payload_json" jsonb NOT NULL,
  "mapping_version_id" integer REFERENCES "inbound_mapping_versions"("id"),
  "status" text DEFAULT 'received' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "error_code" text,
  "error_message" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processing_started_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);
CREATE UNIQUE INDEX "inbound_delivery_event" ON "inbound_deliveries" ("integration_id","event_id");
CREATE INDEX "inbound_delivery_status" ON "inbound_deliveries" ("status","received_at");
CREATE TABLE "inbound_delivery_step_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "delivery_id" integer NOT NULL REFERENCES "inbound_deliveries"("id") ON DELETE CASCADE,
  "step_key" text NOT NULL,
  "status" text NOT NULL,
  "action" text,
  "target_id" integer,
  "message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "inbound_external_object_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "integration_id" integer NOT NULL REFERENCES "inbound_integrations"("id") ON DELETE CASCADE,
  "object_type" text NOT NULL,
  "external_id" text NOT NULL,
  "target_kind" text NOT NULL,
  "target_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "inbound_external_object_key" ON "inbound_external_object_mappings" ("integration_id","object_type","external_id");
CREATE INDEX "inbound_external_target" ON "inbound_external_object_mappings" ("integration_id","target_kind","target_id");