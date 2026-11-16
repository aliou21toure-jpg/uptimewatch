import type { Executor } from "@uptimewatch/db";
import { sql } from "drizzle-orm";

export interface ScheduleResult {
  scheduled: number;
}

/**
 * Plans every due check in one statement:
 * 1. locks due monitors with FOR UPDATE SKIP LOCKED, so concurrent schedulers split the work;
 * 2. picks the slot: the monitor's `next_check_at`, or `now` when that is more than one interval
 *    in the past (the scheduler was down) — missed slots are not replayed in a burst;
 * 3. inserts the check (one per monitor and slot, enforced by a unique constraint) and its outbox
 *    event in the same transaction, so a planned check can never be lost before reaching Redis;
 * 4. advances `next_check_at` by one interval from the slot.
 */
export async function scheduleDueChecks(
  db: Executor,
  { now = new Date(), batchSize = 500 }: { now?: Date; batchSize?: number } = {},
): Promise<ScheduleResult> {
  const result = await db.execute<{ scheduled: number }>(sql`
    WITH due AS (
      SELECT id, org_id, interval_seconds, next_check_at
      FROM monitors
      WHERE enabled AND next_check_at <= ${now}
      ORDER BY next_check_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ),
    slots AS (
      SELECT id, org_id, interval_seconds,
        CASE
          WHEN next_check_at < ${now}::timestamptz - make_interval(secs => interval_seconds)
            THEN date_trunc('second', ${now}::timestamptz)
          ELSE next_check_at
        END AS slot
      FROM due
    ),
    inserted AS (
      INSERT INTO monitor_checks (org_id, monitor_id, scheduled_for)
      SELECT org_id, id, slot FROM slots
      ON CONFLICT (monitor_id, scheduled_for) DO NOTHING
      RETURNING id, org_id, monitor_id, scheduled_for
    ),
    events AS (
      INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, dedupe_key, available_at)
      SELECT 'monitor_check', id, 'check.scheduled',
        jsonb_build_object(
          'checkId', id, 'orgId', org_id, 'monitorId', monitor_id,
          'scheduledFor', to_char(scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'attempt', 0
        ),
        'check.scheduled:' || id, ${now}
      FROM inserted
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING 1
    ),
    advanced AS (
      UPDATE monitors m
      SET next_check_at = s.slot + make_interval(secs => s.interval_seconds)
      FROM slots s
      WHERE m.id = s.id
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM inserted)::int AS scheduled,
           (SELECT count(*) FROM events)::int AS events,
           (SELECT count(*) FROM advanced)::int AS advanced
  `);
  return { scheduled: result.rows[0]?.scheduled ?? 0 };
}
