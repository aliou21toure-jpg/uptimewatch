CREATE TYPE "public"."monitor_state" AS ENUM('unknown', 'healthy', 'degraded', 'down', 'recovering', 'paused');--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"url" text NOT NULL,
	"method" varchar(4) DEFAULT 'GET' NOT NULL,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"expected_status_min" smallint DEFAULT 200 NOT NULL,
	"expected_status_max" smallint DEFAULT 299 NOT NULL,
	"body_contains" text,
	"headers_ciphertext" "bytea",
	"header_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"state" "monitor_state" DEFAULT 'unknown' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"consecutive_successes" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitors_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "monitors_method" CHECK ("monitors"."method" IN ('GET', 'HEAD')),
	CONSTRAINT "monitors_interval" CHECK ("monitors"."interval_seconds" IN (30, 60, 300, 600, 900, 1800, 3600)),
	CONSTRAINT "monitors_timeout_range" CHECK ("monitors"."timeout_ms" BETWEEN 1000 AND 30000),
	CONSTRAINT "monitors_timeout_below_interval" CHECK ("monitors"."timeout_ms" < "monitors"."interval_seconds" * 1000),
	CONSTRAINT "monitors_status_min" CHECK ("monitors"."expected_status_min" BETWEEN 100 AND 599),
	CONSTRAINT "monitors_status_max" CHECK ("monitors"."expected_status_max" BETWEEN "monitors"."expected_status_min" AND 599),
	CONSTRAINT "monitors_body_requires_get" CHECK ("monitors"."method" = 'GET' OR "monitors"."body_contains" IS NULL),
	CONSTRAINT "monitors_counters" CHECK ("monitors"."consecutive_failures" >= 0 AND "monitors"."consecutive_successes" >= 0),
	CONSTRAINT "monitors_paused_consistency" CHECK (("monitors"."enabled" AND "monitors"."state" <> 'paused') OR (NOT "monitors"."enabled" AND "monitors"."state" = 'paused')),
	CONSTRAINT "monitors_url_scheme" CHECK ("monitors"."url" ~* '^https?://')
);
--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitors_due_idx" ON "monitors" USING btree ("next_check_at") WHERE "monitors"."enabled" = TRUE;--> statement-breakpoint
CREATE INDEX "monitors_org_created_idx" ON "monitors" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);