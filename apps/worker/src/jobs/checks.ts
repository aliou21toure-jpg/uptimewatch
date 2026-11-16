import type { Database } from "@uptimewatch/db";
import { schema } from "@uptimewatch/db";
import { applyCheckResult, recordIncidentEffects, type Transition } from "@uptimewatch/domain";
import type { CheckJobData } from "@uptimewatch/queue";
import { and, eq, sql } from "drizzle-orm";

const { monitorChecks, monitors } = schema;

/** Timeouts are capped at 30 s, so a 60 s lease leaves room for DNS, TLS and recording the result. */
export const LEASE_MS = 60_000;

export type MonitorRow = typeof monitors.$inferSelect;

export interface CheckOutcome {
  state: "up" | "down" | "error" | "skipped";
  httpStatus?: number | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** Runs one check against a monitor. Phase 4 provides the HTTP implementation. */
export type CheckExecutor = (monitor: MonitorRow, signal: AbortSignal) => Promise<CheckOutcome>;

export interface Reservation {
  checkId: string;
  scheduledFor: Date;
  /** Fencing token: only the holder of this attempt may record the result. */
  attempt: number;
}

/**
 * Atomically moves a check from `queued` to `running` and grants a lease. Returns null when the
 * check is already running elsewhere, finished, or unknown — duplicate deliveries end here.
 */
export async function reserveCheck(db: Database, data: CheckJobData, now = new Date()): Promise<Reservation | null> {
  const scheduledFor = new Date(data.scheduledFor);
  const [row] = await db
    .update(monitorChecks)
    .set({
      state: "running",
      attempts: sql`${monitorChecks.attempts} + 1`,
      startedAt: now,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    })
    .where(
      and(
        eq(monitorChecks.id, data.checkId),
        eq(monitorChecks.scheduledFor, scheduledFor),
        eq(monitorChecks.state, "queued"),
      ),
    )
    .returning({ attempt: monitorChecks.attempts });
  return row ? { checkId: data.checkId, scheduledFor, attempt: row.attempt } : null;
}

export interface Completion {
  recorded: boolean;
  /** Set when this result opened or resolved an incident (consumed in Phase 5). */
  transition: Transition;
}

/**
 * Records the outcome if this worker still owns the check (same attempt, still running), then
 * moves the monitor's state machine. A worker whose lease expired and was superseded cannot
 * overwrite the newer attempt, and results older than the last applied slot do not move state.
 */
export async function completeCheck(
  db: Database,
  reservation: Reservation,
  outcome: CheckOutcome,
  now = new Date(),
): Promise<Completion> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(monitorChecks)
      .set({
        state: outcome.state,
        finishedAt: now,
        leaseUntil: null,
        httpStatus: outcome.httpStatus ?? null,
        latencyMs: outcome.latencyMs ?? null,
        errorCode: outcome.errorCode?.slice(0, 80) ?? null,
        errorMessage: outcome.errorMessage?.slice(0, 500) ?? null,
      })
      .where(
        and(
          eq(monitorChecks.id, reservation.checkId),
          eq(monitorChecks.scheduledFor, reservation.scheduledFor),
          eq(monitorChecks.state, "running"),
          eq(monitorChecks.attempts, reservation.attempt),
        ),
      )
      .returning({ monitorId: monitorChecks.monitorId, orgId: monitorChecks.orgId });
    if (!row) return { recorded: false, transition: null };
    if (outcome.state !== "up" && outcome.state !== "down") return { recorded: true, transition: null };

    // Lock the monitor so concurrent results for the same monitor apply one after the other.
    const [monitor] = await tx
      .select()
      .from(monitors)
      .where(and(eq(monitors.id, row.monitorId), eq(monitors.orgId, row.orgId)))
      .for("update");
    if (!monitor || !monitor.enabled) return { recorded: true, transition: null };
    if (monitor.lastResultSlot && monitor.lastResultSlot >= reservation.scheduledFor) {
      return { recorded: true, transition: null }; // a newer slot already decided the state
    }

    const { next, transition } = applyCheckResult(monitor, outcome.state);
    // The streak starts at the first failure; it ends with any success.
    const failingSince = outcome.state === "down" ? (monitor.failingSince ?? reservation.scheduledFor) : null;
    await tx
      .update(monitors)
      .set({
        ...next,
        failingSince,
        lastResultSlot: reservation.scheduledFor,
        lastCheckedAt: now,
        ...(outcome.state === "up" ? { lastSuccessAt: now } : {}),
      })
      .where(eq(monitors.id, monitor.id));
    await recordIncidentEffects(tx, transition, {
      monitor: { id: monitor.id, orgId: monitor.orgId, name: monitor.name },
      slot: reservation.scheduledFor,
      failingSince,
      outcome: outcome.state,
      errorCode: outcome.errorCode ?? null,
      errorMessage: outcome.errorMessage ?? null,
      now,
    });
    return { recorded: true, transition };
  });
}

export type ProcessResult = "completed" | "duplicate" | "superseded";

/** The check job: reserve → load monitor → execute → record. */
export async function processCheckJob(
  db: Database,
  executor: CheckExecutor,
  data: CheckJobData,
  { now = () => new Date() }: { now?: () => Date } = {},
): Promise<ProcessResult> {
  const reservation = await reserveCheck(db, data, now());
  if (!reservation) return "duplicate";

  const [monitor] = await db
    .select()
    .from(monitors)
    .where(and(eq(monitors.id, data.monitorId), eq(monitors.orgId, data.orgId)));

  let outcome: CheckOutcome;
  if (!monitor || !monitor.enabled) {
    outcome = { state: "skipped", errorCode: "MONITOR_PAUSED" };
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LEASE_MS - 5_000);
    try {
      outcome = await executor(monitor, controller.signal);
    } catch (error) {
      // An executor crash is a platform error, never a failure of the monitored site.
      outcome = { state: "error", errorCode: "ENGINE_ERROR", errorMessage: error instanceof Error ? error.name : "unknown" };
    } finally {
      clearTimeout(timer);
    }
  }
  return (await completeCheck(db, reservation, outcome, now())).recorded ? "completed" : "superseded";
}
