CREATE TABLE "local_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"storage_dir" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"parent_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_folders_storage_dir_unique" UNIQUE("storage_dir")
);
--> statement-breakpoint
ALTER TABLE "local_folders" ADD CONSTRAINT "local_folders_parent_id_local_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."local_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_folders_single_default_idx" ON "local_folders" USING btree ("is_default") WHERE "local_folders"."is_default" = true;