import { schema, type Executor } from "@uptimewatch/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Transition } from "../monitors/state-machine";

const { incidents, incidentUpdates, outboxEvents } = schema;

export interface ResultContext {
  monitor: { id: string; orgId: string; name: string };
  /** Slot of the check that produced this result. */
  slot: Date;
  /** Slot of the first failure of the current streak, if any. */
  failingSince: Date | null;
  outcome: "up" | "down";
  errorCode: string | null;
  errorMessage: string | null;
  now: Date;
}

const ACTIVE = ["open", "acknowledged"] as const;

/**
 * Applies the incident side of a check result, inside the transaction that recorded it (with the
 * monitor row locked). Opening/resolving also writes an outbox event, so notifications are sent if
 * and only if the incident change is committed.
 */
export async function recordIncidentEffects(tx: Executor, transition: Transition, ctx: ResultContext) {
  const { monitor, now } = ctx;

  if (transition === "incident_opened") {
    const [incident] = await tx
      .insert(incidents)
      .values({
        orgId: monitor.orgId,
        monitorId: monitor.id,
        title: `${monitor.name} is down`.slice(0, 200),
        openedAt: ctx.failingSince ?? ctx.slot,
        detectedAt: now,
        causeCode: ctx.errorCode,
        causeMessage: ctx.errorMessage?.slice(0, 500) ?? null,
        failedCheckCount: 2,
      })
      // The partial unique index already prevents a second active incident; never fail the check for it.
      .onConflictDoNothing()
      .returning({ id: incidents.id });
    if (!incident) return null;
    await tx.insert(incidentUpdates).values({
      orgId: monitor.orgId,
      incidentId: incident.id,
      status: "investigating",
      message: `Outage confirmed after 2 consecutive failed checks${ctx.errorMessage ? `: ${ctx.errorMessage}` : ""}.`,
    });
    await tx.insert(outboxEvents).values({
      aggregateType: "incident",
      aggregateId: incident.id,
      eventType: "incident.opened",
      payload: { incidentId: incident.id, orgId: monitor.orgId },
      dedupeKey: `incident.opened:${incident.id}`,
      availableAt: now,
    });
    return { incidentId: incident.id, event: "opened" as const };
  }

  if (transition === "incident_resolved") {
    const [incident] = await tx
      .update(incidents)
      .set({ status: "resolved", resolvedAt: now, updatedAt: now })
      .where(and(eq(incidents.monitorId, monitor.id), eq(incidents.orgId, monitor.orgId), inArray(incidents.status, [...ACTIVE])))
      .returning({ id: incidents.id });
    if (!incident) return null;
    await tx.insert(incidentUpdates).values({
      orgId: monitor.orgId,
      incidentId: incident.id,
      status: "resolved",
      message: "Service recovered: 2 consecutive successful checks.",
    });
    await tx.insert(outboxEvents).values({
      aggregateType: "incident",
      aggregateId: incident.id,
      eventType: "incident.resolved",
      payload: { incidentId: incident.id, orgId: monitor.orgId },
      dedupeKey: `incident.resolved:${incident.id}`,
      availableAt: now,
    });
    return { incidentId: incident.id, event: "resolved" as const };
  }

  if (ctx.outcome === "down") {
    // Still failing during an open incident: keep the count of failed checks up to date.
    await tx
      .update(incidents)
      .set({ failedCheckCount: sql`${incidents.failedCheckCount} + 1`, updatedAt: now })
      .where(and(eq(incidents.monitorId, monitor.id), eq(incidents.orgId, monitor.orgId), inArray(incidents.status, [...ACTIVE])));
  }
  return null;
}

/**
 * Closes the active incident when the monitor's state machine is reset (pause, new URL): the
 * reset monitor could never resolve it on its own. No notification is sent for this.
 */
export async function closeActiveIncident(tx: Executor, orgId: string, monitorId: string, now: Date, userId: string, reason: string) {
  const [incident] = await tx
    .update(incidents)
    .set({ status: "resolved", resolvedAt: now, updatedAt: now })
    .where(and(eq(incidents.monitorId, monitorId), eq(incidents.orgId, orgId), inArray(incidents.status, [...ACTIVE])))
    .returning({ id: incidents.id });
  if (incident) {
    await tx.insert(incidentUpdates).values({
      orgId,
      incidentId: incident.id,
      status: "resolved",
      message: reason,
      createdBy: userId,
    });
  }
}
