import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, numeric, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { monitors } from "./monitors";

/**
 * One row per monitor and UTC day, rebuilt from monitor_checks by the worker. Kept 13 months,
 * while raw checks are kept 30 days (spec §2.6).
 */
export const monitorDailyStats = pgTable(
  "monitor_daily_stats",
  {
    orgId: uuid("org_id").notNull(),
    monitorId: uuid("monitor_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    /** Checks with a verdict on the monitored service (up + down). */
    totalChecks: integer("total_checks").notNull().default(0),
    successfulChecks: integer("successful_checks").notNull().default(0),
    failedChecks: integer("failed_checks").notNull().default(0),
    /** Platform-side problems: excluded from uptime, counted against coverage. */
    platformErrorChecks: integer("platform_error_checks").notNull().default(0),
    skippedChecks: integer("skipped_checks").notNull().default(0),
    missedSlots: integer("missed_slots").notNull().default(0),
    uptimePercentage: numeric("uptime_percentage", { precision: 6, scale: 3 }),
    coveragePercentage: numeric("coverage_percentage", { precision: 6, scale: 3 }),
    avgLatencyMs: integer("avg_latency_ms"),
    p50LatencyMs: integer("p50_latency_ms"),
    p95LatencyMs: integer("p95_latency_ms"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.monitorId, t.day] }),
    foreignKey({ columns: [t.orgId, t.monitorId], foreignColumns: [monitors.orgId, monitors.id] }).onDelete("cascade"),
    index("monitor_daily_stats_org_day_idx").on(t.orgId, t.day),
    check("monitor_daily_stats_counts", sql`${t.totalChecks} = ${t.successfulChecks} + ${t.failedChecks}`),
  ],
);
