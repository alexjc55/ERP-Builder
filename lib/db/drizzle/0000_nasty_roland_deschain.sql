CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role_id" integer NOT NULL,
	"language" text DEFAULT 'ru' NOT NULL,
	"direction" text DEFAULT 'ltr' NOT NULL,
	"start_page_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "guest_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_json" jsonb DEFAULT '{}'::jsonb,
	"permissions_json" jsonb DEFAULT '{"superAdmin":false,"admin":{"pages":false,"entities":false,"roles":false,"users":false,"translations":false,"events":false,"modules":false,"automations":false,"customFilters":false,"columnGroups":false,"googleDrive":false,"settings":false,"dataImport":false},"pageIds":[],"records":{}}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_json" jsonb DEFAULT '{}'::jsonb,
	"icon" text DEFAULT 'file' NOT NULL,
	"path" text,
	"parent_page_id" integer,
	"mirror_entity_id" integer,
	"mirror_field_keys_json" jsonb,
	"mirror_field_labels_json" jsonb,
	"mirror_column_order_json" jsonb,
	"column_groups_json" jsonb,
	"mirror_pinned_json" jsonb,
	"is_dashboard" boolean DEFAULT false NOT NULL,
	"is_pivot" boolean DEFAULT false NOT NULL,
	"pivot_entity_id" integer,
	"pivot_config_json" jsonb,
	"group_by_field_key" text,
	"group_default_expanded" boolean DEFAULT false NOT NULL,
	"widgets_collapsed_default" boolean DEFAULT false NOT NULL,
	"default_quick_filter_json" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_widgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"title_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_role_ids_json" jsonb,
	"icon" text DEFAULT 'bar-chart-3' NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"grid_w" integer DEFAULT 1 NOT NULL,
	"grid_h" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"field_key" text NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_json" jsonb DEFAULT '{}'::jsonb,
	"field_type" text DEFAULT 'text' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"pivot_enabled" boolean DEFAULT false NOT NULL,
	"default_value" text,
	"options_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"format_rules_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"formula_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"percent_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relation_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"permissions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"show_in_table" boolean DEFAULT true NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"show_column_total" boolean DEFAULT false NOT NULL,
	"total_fill_color" text,
	"total_text_color" text,
	"column_group_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_field_key_unique" UNIQUE("page_id","field_key")
);
--> statement-breakpoint
CREATE TABLE "page_record_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"values_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_record_value_unique" UNIQUE("page_id","record_id")
);
--> statement-breakpoint
CREATE TABLE "translations" (
	"id" serial PRIMARY KEY NOT NULL,
	"translation_key" text NOT NULL,
	"translations_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "translations_translation_key_unique" UNIQUE("translation_key")
);
--> statement-breakpoint
CREATE TABLE "login_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ip_address" text DEFAULT '' NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer,
	"record_id" integer,
	"field_key" text,
	"old_value" text,
	"new_value" text,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"entity_id" integer,
	"record_id" integer,
	"payload_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"module_key" text NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modules_module_key_unique" UNIQUE("module_key")
);
--> statement-breakpoint
CREATE TABLE "column_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"display_mode" text DEFAULT 'bar' NOT NULL,
	"text_color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_key" text NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_json" jsonb DEFAULT '{}'::jsonb,
	"icon" text DEFAULT 'table' NOT NULL,
	"page_id" integer,
	"default_sort_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_filter_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pivot_enabled" boolean DEFAULT false NOT NULL,
	"allow_no_status" boolean DEFAULT true NOT NULL,
	"default_pivot_json" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_entity_key_unique" UNIQUE("entity_key")
);
--> statement-breakpoint
CREATE TABLE "entity_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"field_key" text NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_json" jsonb DEFAULT '{}'::jsonb,
	"field_type" text DEFAULT 'text' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"default_value" text,
	"default_to_today" boolean DEFAULT false NOT NULL,
	"options_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format_rules_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_rules_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"formula_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"percent_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dependency_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relation_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_key" boolean DEFAULT false NOT NULL,
	"lock_after_create" boolean DEFAULT false NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"pivot_enabled" boolean DEFAULT false NOT NULL,
	"show_in_table" boolean DEFAULT true NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"show_column_total" boolean DEFAULT false NOT NULL,
	"wrap_text" boolean DEFAULT false NOT NULL,
	"total_fill_color" text,
	"total_text_color" text,
	"column_group_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_field_key_unique" UNIQUE("entity_id","field_key")
);
--> statement-breakpoint
CREATE TABLE "entity_statuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"status_key" text NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"is_archive_trigger" boolean DEFAULT false NOT NULL,
	"archive_after_days" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_status_key_unique" UNIQUE("entity_id","status_key")
);
--> statement-breakpoint
CREATE TABLE "entity_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"values_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_id" integer,
	"archived_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"archive_exempt" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"relation_id" integer NOT NULL,
	"relation_type" text NOT NULL,
	"source_record_id" integer NOT NULL,
	"target_record_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_link_unique" UNIQUE("relation_id","source_record_id","target_record_id")
);
--> statement-breakpoint
CREATE TABLE "relations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_entity_id" integer NOT NULL,
	"target_entity_id" integer NOT NULL,
	"relation_key" text NOT NULL,
	"relation_type" text DEFAULT 'one_to_many' NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inverse_name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relation_source_key_unique" UNIQUE("source_entity_id","relation_key")
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"view_key" text NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_role_ids_json" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_entity_key_unique" UNIQUE("entity_id","view_key")
);
--> statement-breakpoint
CREATE TABLE "entity_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"from_status_id" integer,
	"to_status_id" integer NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_field_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"entity_id" integer NOT NULL,
	"record_id" integer,
	"status" text NOT NULL,
	"trigger_name" text,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"trigger_json" jsonb NOT NULL,
	"conditions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"condition_conjunction" text DEFAULT 'and' NOT NULL,
	"actions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_filters" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"conjunction" text DEFAULT 'and' NOT NULL,
	"groups_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inputs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_drive_connection" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_mode" text DEFAULT 'builtin' NOT NULL,
	"own_client_id" text,
	"own_client_secret_enc" text,
	"refresh_token_enc" text,
	"account_email" text,
	"folder_id" text,
	"folder_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_drive_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"drive_folder_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"parent_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_drive_folders_drive_folder_id_unique" UNIQUE("drive_folder_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"app_name_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subtitle_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logo_object_path" text,
	"currency_symbol" text DEFAULT '₽' NOT NULL,
	"default_language" text DEFAULT 'ru' NOT NULL,
	"table_style" text DEFAULT 'plain' NOT NULL,
	"table_stripe_color" text,
	"table_header_color" text,
	"table_border_color" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deleted_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer,
	"entity_name_json" jsonb,
	"record_id" integer,
	"field_key" text NOT NULL,
	"field_name_json" jsonb,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"content_type" text,
	"reason" text NOT NULL,
	"deleted_by" integer,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_fields" ADD CONSTRAINT "page_fields_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_record_values" ADD CONSTRAINT "page_record_values_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_record_values" ADD CONSTRAINT "page_record_values_record_id_entity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_fields" ADD CONSTRAINT "entity_fields_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_statuses" ADD CONSTRAINT "entity_statuses_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_records" ADD CONSTRAINT "entity_records_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_records" ADD CONSTRAINT "entity_records_status_id_entity_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."entity_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_relation_id_relations_id_fk" FOREIGN KEY ("relation_id") REFERENCES "public"."relations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_source_record_id_entity_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_target_record_id_entity_records_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_target_entity_id_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_transitions" ADD CONSTRAINT "entity_transitions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_transitions" ADD CONSTRAINT "entity_transitions_from_status_id_entity_statuses_id_fk" FOREIGN KEY ("from_status_id") REFERENCES "public"."entity_statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_transitions" ADD CONSTRAINT "entity_transitions_to_status_id_entity_statuses_id_fk" FOREIGN KEY ("to_status_id") REFERENCES "public"."entity_statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_automation_runs" ADD CONSTRAINT "entity_automation_runs_automation_id_entity_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."entity_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_automations" ADD CONSTRAINT "entity_automations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_filters" ADD CONSTRAINT "custom_filters_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_drive_folders" ADD CONSTRAINT "google_drive_folders_parent_id_google_drive_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."google_drive_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_status_one_default" ON "entity_statuses" USING btree ("entity_id") WHERE "entity_statuses"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "record_link_source_one" ON "record_links" USING btree ("relation_id","source_record_id") WHERE "record_links"."relation_type" in ('one_to_one','many_to_one');--> statement-breakpoint
CREATE UNIQUE INDEX "record_link_target_one" ON "record_links" USING btree ("relation_id","target_record_id") WHERE "record_links"."relation_type" in ('one_to_one','one_to_many');--> statement-breakpoint
CREATE UNIQUE INDEX "view_one_default" ON "views" USING btree ("entity_id") WHERE "views"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_transition_specific_unique" ON "entity_transitions" USING btree ("entity_id","from_status_id","to_status_id") WHERE "entity_transitions"."from_status_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_transition_wildcard_unique" ON "entity_transitions" USING btree ("entity_id","to_status_id") WHERE "entity_transitions"."from_status_id" is null;--> statement-breakpoint
CREATE INDEX "entity_transition_entity_idx" ON "entity_transitions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_transition_from_idx" ON "entity_transitions" USING btree ("from_status_id");--> statement-breakpoint
CREATE INDEX "entity_automation_run_automation_idx" ON "entity_automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "entity_automation_run_entity_idx" ON "entity_automation_runs" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_automation_run_dedupe_unique" ON "entity_automation_runs" USING btree ("automation_id","record_id","dedupe_key") WHERE "entity_automation_runs"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "entity_automation_entity_idx" ON "entity_automations" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "custom_filter_entity_idx" ON "custom_filters" USING btree ("entity_id");