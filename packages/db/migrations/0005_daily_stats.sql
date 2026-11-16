CREATE TABLE "monitor_daily_stats" (
	"org_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"day" date NOT NULL,
	"total_checks" integer DEFAULT 0 NOT NULL,
	"successful_checks" integer DEFAULT 0 NOT NULL,
	"failed_checks" integer DEFAULT 0 NOT NULL,
	"platform_error_checks" integer DEFAULT 0 NOT NULL,
	"skipped_checks" integer DEFAULT 0 NOT NULL,
	"missed_slots" integer DEFAULT 0 NOT NULL,
	"uptime_percentage" numeric(6, 3),
	"coverage_percentage" numeric(6, 3),
	"avg_latency_ms" integer,
	"p50_latency_ms" integer,
	"p95_latency_ms" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitor_daily_stats_monitor_id_day_pk" PRIMARY KEY("monitor_id","day"),
	CONSTRAINT "monitor_daily_stats_counts" CHECK ("monitor_daily_stats"."total_checks" = "monitor_daily_stats"."successful_checks" + "monitor_daily_stats"."failed_checks")
);
--> statement-breakpoint
ALTER TABLE "monitor_checks" ADD COLUMN "missed_slots" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "monitor_daily_stats" ADD CONSTRAINT "monitor_daily_stats_org_id_monitor_id_monitors_org_id_id_fk" FOREIGN KEY ("org_id","monitor_id") REFERENCES "public"."monitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitor_daily_stats_org_day_idx" ON "monitor_daily_stats" USING btree ("org_id","day");