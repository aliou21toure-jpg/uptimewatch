import type { Database } from "@uptimewatch/db";
import { sql } from "drizzle-orm";

export const CHECK_RETENTION_DAYS = 30;
export const OUTBOX_RETENTION_DAYS = 7;
const PARTITIONS_AHEAD_DAYS = 7;

/**
 * Daily-partition upkeep and retention, safe to run from every worker: an advisory lock makes
 * concurrent runs no-ops. Retention drops whole partitions instead of deleting rows.
 */
export async function runMaintenance(db: Database, now = new Date()) {
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended('uptimewatch:maintenance', 0)) AS locked`,
    );
    if (!lock.rows[0]?.locked) return null;

    const today = sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date`;
    const created = await tx.execute<{ n: number }>(
      sql`SELECT ensure_monitor_check_partitions(${today} - 1, ${PARTITIONS_AHEAD_DAYS + 1}::int) AS n`,
    );
    const dropped = await tx.execute<{ n: number }>(
      sql`SELECT drop_monitor_check_partitions_before(${today} - ${CHECK_RETENTION_DAYS}::int) AS n`,
    );
    const outbox = await tx.execute(
      sql`DELETE FROM outbox_events WHERE published_at < ${now.toISOString()}::timestamptz - make_interval(days => ${OUTBOX_RETENTION_DAYS}::int)`,
    );
    return {
      partitionsCreated: created.rows[0]?.n ?? 0,
      partitionsDropped: dropped.rows[0]?.n ?? 0,
      outboxDeleted: outbox.rowCount ?? 0,
    };
  });
}
