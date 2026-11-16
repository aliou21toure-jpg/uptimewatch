import type { MonitorState } from "@uptimewatch/db/schema";

/** Spec §2.2: two consecutive failures confirm an outage, two consecutive successes end it. */
export const FAILURE_THRESHOLD = 2;
export const RECOVERY_THRESHOLD = 2;

export interface MonitorHealth {
  state: MonitorState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export type Transition = "incident_opened" | "incident_resolved" | null;

/**
 * HEALTHY → DEGRADED → DOWN → RECOVERING → HEALTHY.
 * - one failure only degrades (no incident yet: protects against blips);
 * - the second consecutive failure confirms the outage (incident opened);
 * - while down, one success is not enough (RECOVERING); the second resolves the incident;
 * - a failure while recovering returns to DOWN without opening a second incident.
 * Only `up`/`down` outcomes reach this function: platform errors and skipped checks never move state.
 */
export function applyCheckResult(current: MonitorHealth, result: "up" | "down"): { next: MonitorHealth; transition: Transition } {
  if (current.state === "paused") return { next: current, transition: null };

  if (result === "up") {
    const successes = current.consecutiveSuccesses + 1;
    const counters = { consecutiveFailures: 0, consecutiveSuccesses: successes };
    if (current.state === "down" || current.state === "recovering") {
      return successes >= RECOVERY_THRESHOLD
        ? { next: { state: "healthy", ...counters }, transition: "incident_resolved" }
        : { next: { state: "recovering", ...counters }, transition: null };
    }
    return { next: { state: "healthy", ...counters }, transition: null };
  }

  const failures = current.consecutiveFailures + 1;
  const counters = { consecutiveFailures: failures, consecutiveSuccesses: 0 };
  if (current.state === "down" || current.state === "recovering") {
    return { next: { state: "down", ...counters }, transition: null };
  }
  return failures >= FAILURE_THRESHOLD
    ? { next: { state: "down", ...counters }, transition: "incident_opened" }
    : { next: { state: "degraded", ...counters }, transition: null };
}
