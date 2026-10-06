CREATE TABLE "security_event_reviews" (
	"event_id" integer PRIMARY KEY NOT NULL,
	"reviewed_by" integer NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"is_alert" boolean DEFAULT false NOT NULL,
	"actor_user_id" integer,
	"impersonator_user_id" integer,
	"target_user_id" integer,
	"agent_id" integer,
	"integration_id" integer,
	"auth_source" text DEFAULT 'anonymous' NOT NULL,
	"session_ref" text,
	"login_email" text,
	"peer_ip" text NOT NULL,
	"client_ip" text NOT NULL,
	"ip_source" text NOT NULL,
	"user_agent" text,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"status_code" integer,
	"reason" text,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "security_event_reviews" ADD CONSTRAINT "security_event_reviews_event_id_security_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."security_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_events_time_idx" ON "security_events" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "security_events_request_idx" ON "security_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "security_events_session_idx" ON "security_events" USING btree ("session_ref");--> statement-breakpoint
CREATE INDEX "security_events_actor_idx" ON "security_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "security_events_login_idx" ON "security_events" USING btree ("login_email","created_at");--> statement-breakpoint
CREATE INDEX "security_events_alert_idx" ON "security_events" USING btree ("is_alert","created_at");