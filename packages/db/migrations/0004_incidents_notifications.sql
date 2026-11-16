CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('minor', 'major', 'critical');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."incident_update_status" AS ENUM('investigating', 'identified', 'monitoring', 'resolved');--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" "incident_update_status" NOT NULL,
	"message" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_updates_message_length" CHECK (char_length("incident_updates"."message") BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"severity" "incident_severity" DEFAULT 'major' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"resolved_at" timestamp with time zone,
	"cause_code" varchar(80),
	"cause_message" varchar(500),
	"failed_check_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "incidents_resolved_consistency" CHECK (("incidents"."status" = 'resolved') = ("incidents"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_once" UNIQUE("incident_id","user_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"incident_opened" boolean DEFAULT true NOT NULL,
	"incident_resolved" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_org_user_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "monitors" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_org_id_incident_id_incidents_org_id_id_fk" FOREIGN KEY ("org_id","incident_id") REFERENCES "public"."incidents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_acknowledged_by_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_id_monitor_id_monitors_org_id_id_fk" FOREIGN KEY ("org_id","monitor_id") REFERENCES "public"."monitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_org_id_incident_id_incidents_org_id_id_fk" FOREIGN KEY ("org_id","incident_id") REFERENCES "public"."incidents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_updates_incident_idx" ON "incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_one_active_per_monitor" ON "incidents" USING btree ("monitor_id") WHERE "incidents"."status" IN ('open', 'acknowledged');--> statement-breakpoint
CREATE INDEX "incidents_org_history_idx" ON "incidents" USING btree ("org_id","opened_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_monitor_history_idx" ON "incidents" USING btree ("monitor_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_deliveries_due_idx" ON "notification_deliveries" USING btree ("next_attempt_at") WHERE "notification_deliveries"."status" = 'pending';