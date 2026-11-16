import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors";

export const checkState = pgEnum("check_state", ["queued", "running", "up", "down", "error", "skipped"]);
export type CheckState = (typeof checkState.enumValues)[number];

/**
 * One row per planned check slot. In PostgreSQL this table is RANGE-partitioned by day on
 * `scheduled_for` (see migration 0002), so the 30-day retention is a cheap partition drop.
 * A partitioned table's keys must include the partition key, hence `(id, scheduled_for)`.
 */
export const monitorChecks = pgTable(
  "monitor_checks",
  {
    id: uuid("id").notNull().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    monitorId: uuid("monitor_id").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    state: checkState("state").notNull().default("queued"),
    /** Executions started (lease reservations). Bounded by the recovery job. */
    attempts: smallint("attempts").notNull().default(0),
    /** When the check was last put in the queue (first scheduling or recovery). */
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    httpStatus: smallint("http_status"),
    latencyMs: integer("latency_ms"),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: varchar("error_message", { length: 500 }),
    /** Slots skipped right before this one because the platform was behind (coverage indicator). */
    missedSlots: integer("missed_slots").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.scheduledFor] }),
    // Exactly one check per monitor and slot, whatever happens upstream (spec §10.3).
    unique("monitor_checks_slot_unique").on(t.monitorId, t.scheduledFor),
    foreignKey({ columns: [t.orgId, t.monitorId], foreignColumns: [monitors.orgId, monitors.id] }).onDelete("cascade"),
    index("monitor_checks_running_lease_idx").on(t.leaseUntil).where(sql`${t.state} = 'running'`),
    index("monitor_checks_queued_idx").on(t.queuedAt).where(sql`${t.state} = 'queued'`),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull().unique(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outbox_pending_idx").on(t.availableAt).where(sql`${t.publishedAt} IS NULL`),
    index("outbox_published_idx").on(t.publishedAt).where(sql`${t.publishedAt} IS NOT NULL`),
  ],
);
