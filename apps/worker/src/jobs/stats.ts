import type { Executor } from "@uptimewatch/db";
import { sql } from "drizzle-orm";

export const DAILY_STATS_RETENTION_MONTHS = 13;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Rebuilds `monitor_daily_stats` for the UTC days in [from, to] from the raw checks.
 * - uptime = up / (up + down): platform errors and skipped checks are excluded (spec §2.6);
 * - coverage = (up + down) / (up + down + platform errors + skipped + missed slots);
 * - latency (avg, exact P50/P95) is computed over successful checks only, so timeouts do not
 *   masquerade as slow responses.
 * Idempotent (upsert), so it can run on every worker and be re-run at will.
 */
export async function refreshDailyStats(db: Executor, from: Date, to: Date = from): Promise<number> {
  const start = utcDay(from);
  const end = utcDay(to);
  const result = await db.execute(sql`
    INSERT INTO monitor_daily_stats AS s (
      org_id, monitor_id, day, total_checks, successful_checks, failed_checks,
      platform_error_checks, skipped_checks, missed_slots,
      uptime_percentage, coverage_percentage, avg_latency_ms, p50_latency_ms, p95_latency_ms, updated_at
    )
    SELECT
      c.org_id, c.monitor_id, (c.scheduled_for AT TIME ZONE 'UTC')::date AS day,
      count(*) FILTER (WHERE c.state IN ('up', 'down')),
      count(*) FILTER (WHERE c.state = 'up'),
      count(*) FILTER (WHERE c.state = 'down'),
      count(*) FILTER (WHERE c.state = 'error'),
      count(*) FILTER (WHERE c.state = 'skipped'),
      COALESCE(sum(c.missed_slots), 0),
      round(100.0 * count(*) FILTER (WHERE c.state = 'up') / NULLIF(count(*) FILTER (WHERE c.state IN ('up', 'down')), 0), 3),
      round(100.0 * count(*) FILTER (WHERE c.state IN ('up', 'down')) / NULLIF(count(*) + COALESCE(sum(c.missed_slots), 0), 0), 3),
      round(avg(c.latency_ms) FILTER (WHERE c.state = 'up')),
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY c.latency_ms) FILTER (WHERE c.state = 'up')),
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY c.latency_ms) FILTER (WHERE c.state = 'up')),
      now()
    FROM monitor_checks c
    WHERE c.scheduled_for >= ${start}::date AT TIME ZONE 'UTC'
      AND c.scheduled_for < (${end}::date + 1) AT TIME ZONE 'UTC'
      AND c.state NOT IN ('queued', 'running')
    GROUP BY c.org_id, c.monitor_id, day
    ON CONFLICT (monitor_id, day) DO UPDATE SET
      total_checks = excluded.total_checks,
      successful_checks = excluded.successful_checks,
      failed_checks = excluded.failed_checks,
      platform_error_checks = excluded.platform_error_checks,
      skipped_checks = excluded.skipped_checks,
      missed_slots = excluded.missed_slots,
      uptime_percentage = excluded.uptime_percentage,
      coverage_percentage = excluded.coverage_percentage,
      avg_latency_ms = excluded.avg_latency_ms,
      p50_latency_ms = excluded.p50_latency_ms,
      p95_latency_ms = excluded.p95_latency_ms,
      updated_at = excluded.updated_at
  `);
  return result.rowCount ?? 0;
}

/** Today and yesterday (late results may still land on yesterday right after midnight UTC). */
export function refreshRecentDailyStats(db: Executor, now = new Date()) {
  return refreshDailyStats(db, new Date(now.getTime() - 86_400_000), now);
}
