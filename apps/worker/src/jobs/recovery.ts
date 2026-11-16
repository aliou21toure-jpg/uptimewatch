import type { Database } from "@uptimewatch/db";
import { sql } from "drizzle-orm";

export const MAX_CHECK_ATTEMPTS = 3;
/** A queued check whose job never ran (e.g. Redis lost it) is re-published after this delay. */
export const STUCK_QUEUED_MS = 2 * 60_000;
/** Checks older than this are not worth running any more: the next slot will cover the monitor. */
export const STALE_AFTER_MS = 10 * 60_000;

export interface RecoveryResult {
  requeued: number;
  failed: number;
  stale: number;
}

const toTimestamp = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * Recovers abandoned work:
 * - `running` checks whose lease expired (worker crashed or hung) are re-queued with a new attempt,
 *   or marked as a platform `error` (LEASE_EXPIRED) after MAX_CHECK_ATTEMPTS — never as a site failure;
 * - `queued` checks that were never picked up are re-published;
 * - checks older than STALE_AFTER_MS are `skipped` instead of being run late.
 * Re-publication goes through the outbox, with one dedupe key per (check, attempt).
 */
export async function recoverAbandonedChecks(db: Database, now = new Date()): Promise<RecoveryResult> {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  const stuckBefore = new Date(now.getTime() - STUCK_QUEUED_MS);

  return db.transaction(async (tx) => {
    const stale = await tx.execute(sql`
      UPDATE monitor_checks
      SET state = 'skipped', finished_at = ${toTimestamp(now)}, lease_until = NULL, error_code = 'STALE'
      WHERE scheduled_for < ${toTimestamp(staleBefore)}
        AND (state = 'queued' OR (state = 'running' AND lease_until < ${toTimestamp(now)}))
    `);

    const failed = await tx.execute(sql`
      UPDATE monitor_checks
      SET state = 'error', finished_at = ${toTimestamp(now)}, lease_until = NULL, error_code = 'LEASE_EXPIRED',
          error_message = 'The check did not complete after ' || attempts || ' attempts'
      WHERE state = 'running' AND lease_until < ${toTimestamp(now)} AND attempts >= ${MAX_CHECK_ATTEMPTS}
    `);

    const requeued = await tx.execute<{ id: string }>(sql`
      WITH candidates AS (
        SELECT id, scheduled_for FROM monitor_checks
        WHERE (state = 'running' AND lease_until < ${toTimestamp(now)})
           OR (state = 'queued' AND queued_at < ${toTimestamp(stuckBefore)})
        FOR UPDATE SKIP LOCKED
      ),
      reset AS (
        UPDATE monitor_checks c
        SET state = 'queued', lease_until = NULL, queued_at = ${toTimestamp(now)}
        FROM candidates k
        WHERE c.id = k.id AND c.scheduled_for = k.scheduled_for
        RETURNING c.id, c.org_id, c.monitor_id, c.scheduled_for, c.attempts
      )
      INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, dedupe_key, available_at)
      SELECT 'monitor_check', id, 'check.scheduled',
        jsonb_build_object(
          'checkId', id, 'orgId', org_id, 'monitorId', monitor_id,
          'scheduledFor', to_char(scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'attempt', attempts
        ),
        'check.requeued:' || id || ':' || attempts || ':' || extract(epoch FROM ${toTimestamp(now)})::bigint,
        ${toTimestamp(now)}
      FROM reset
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING aggregate_id AS id
    `);

    return { requeued: requeued.rowCount ?? 0, failed: failed.rowCount ?? 0, stale: stale.rowCount ?? 0 };
  });
}
