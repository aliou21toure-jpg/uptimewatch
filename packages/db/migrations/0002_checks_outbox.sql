CREATE TYPE "public"."check_state" AS ENUM('queued', 'running', 'up', 'down', 'error', 'skipped');--> statement-breakpoint
CREATE TABLE "monitor_checks" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"monitor_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"state" "check_state" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"http_status" smallint,
	"latency_ms" integer,
	"error_code" varchar(80),
	"error_message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitor_checks_id_scheduled_for_pk" PRIMARY KEY("id","scheduled_for"),
	CONSTRAINT "monitor_checks_slot_unique" UNIQUE("monitor_id","scheduled_for")
) PARTITION BY RANGE ("scheduled_for");
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "monitor_checks" ADD CONSTRAINT "monitor_checks_org_id_monitor_id_monitors_org_id_id_fk" FOREIGN KEY ("org_id","monitor_id") REFERENCES "public"."monitors"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitor_checks_running_lease_idx" ON "monitor_checks" USING btree ("lease_until") WHERE "monitor_checks"."state" = 'running';--> statement-breakpoint
CREATE INDEX "monitor_checks_queued_idx" ON "monitor_checks" USING btree ("queued_at") WHERE "monitor_checks"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_published_idx" ON "outbox_events" USING btree ("published_at") WHERE "outbox_events"."published_at" IS NOT NULL;--> statement-breakpoint
-- Hand-written: daily partitions for monitor_checks (spec amendment #6).
-- Partitions are named monitor_checks_pYYYYMMDD and cover one UTC day.
CREATE FUNCTION ensure_monitor_check_partitions(from_day date, days_ahead integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  d date;
  created integer := 0;
  part text;
BEGIN
  FOR i IN 0..days_ahead LOOP
    d := from_day + i;
    part := format('monitor_checks_p%s', to_char(d, 'YYYYMMDD'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF monitor_checks FOR VALUES FROM (%L) TO (%L)',
        part, (d::timestamp AT TIME ZONE 'UTC'), ((d + 1)::timestamp AT TIME ZONE 'UTC')
      );
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;
--> statement-breakpoint
CREATE FUNCTION drop_monitor_check_partitions_before(cutoff date)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  r record;
  dropped integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'monitor_checks' AND c.relname ~ '^monitor_checks_p[0-9]{8}$'
  LOOP
    IF to_date(substr(r.relname, 17), 'YYYYMMDD') < cutoff THEN
      EXECUTE format('DROP TABLE %I', r.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END $$;
--> statement-breakpoint
SELECT ensure_monitor_check_partitions((now() AT TIME ZONE 'UTC')::date - 1, 8);