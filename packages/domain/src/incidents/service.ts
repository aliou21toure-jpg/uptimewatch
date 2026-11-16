import { schema, type Database, type Executor } from "@uptimewatch/db";
import { and, asc, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { DomainError, conflict, notFound } from "../errors";
import { authorize, type Actor } from "../organizations/service";

const { incidents, incidentUpdates, monitors, notificationDeliveries, notificationPreferences, user } = schema;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const listIncidentsQuery = z.object({
  status: z.enum(["open", "acknowledged", "resolved", "active"]).optional(),
  monitorId: z.string().regex(UUID_RE).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

const incidentColumns = {
  id: incidents.id,
  monitorId: incidents.monitorId,
  monitorName: monitors.name,
  title: incidents.title,
  status: incidents.status,
  severity: incidents.severity,
  openedAt: incidents.openedAt,
  detectedAt: incidents.detectedAt,
  acknowledgedAt: incidents.acknowledgedAt,
  resolvedAt: incidents.resolvedAt,
  causeCode: incidents.causeCode,
  causeMessage: incidents.causeMessage,
  failedCheckCount: incidents.failedCheckCount,
};

export async function listIncidents(db: Executor, actor: Actor, orgId: string, raw: unknown) {
  await authorize(db, actor, orgId, "incident:read");
  const q = listIncidentsQuery.parse(raw);
  const filters: SQL[] = [eq(incidents.orgId, orgId)];
  if (q.status === "active") filters.push(inArray(incidents.status, ["open", "acknowledged"]));
  else if (q.status) filters.push(eq(incidents.status, q.status));
  if (q.monitorId) filters.push(eq(incidents.monitorId, q.monitorId));
  if (q.cursor) {
    let c: [string, string];
    try {
      c = JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8")) as [string, string];
      if (!UUID_RE.test(c[1]) || Number.isNaN(new Date(c[0]).getTime())) throw new Error();
    } catch {
      throw new DomainError("VALIDATION_ERROR", "Invalid cursor");
    }
    const at = new Date(c[0]);
    filters.push(or(lt(incidents.openedAt, at), and(eq(incidents.openedAt, at), lt(incidents.id, c[1])))!);
  }
  const rows = await db
    .select(incidentColumns)
    .from(incidents)
    .innerJoin(monitors, and(eq(monitors.id, incidents.monitorId), eq(monitors.orgId, incidents.orgId)))
    .where(and(...filters))
    .orderBy(desc(incidents.openedAt), desc(incidents.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    data: page,
    nextCursor:
      rows.length > q.limit && last
        ? Buffer.from(JSON.stringify([last.openedAt.toISOString(), last.id])).toString("base64url")
        : null,
  };
}

export async function getIncident(db: Executor, actor: Actor, orgId: string, incidentId: string) {
  await authorize(db, actor, orgId, "incident:read");
  if (!UUID_RE.test(incidentId)) throw notFound("Incident");
  const [incident] = await db
    .select({ ...incidentColumns, monitorUrl: monitors.url, acknowledgedByName: user.name })
    .from(incidents)
    .innerJoin(monitors, and(eq(monitors.id, incidents.monitorId), eq(monitors.orgId, incidents.orgId)))
    .leftJoin(user, eq(user.id, incidents.acknowledgedBy))
    .where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId)));
  if (!incident) throw notFound("Incident");

  const updates = await db
    .select({
      id: incidentUpdates.id,
      status: incidentUpdates.status,
      message: incidentUpdates.message,
      createdAt: incidentUpdates.createdAt,
      authorName: user.name,
    })
    .from(incidentUpdates)
    .leftJoin(user, eq(user.id, incidentUpdates.createdBy))
    .where(and(eq(incidentUpdates.incidentId, incidentId), eq(incidentUpdates.orgId, orgId)))
    .orderBy(asc(incidentUpdates.createdAt));

  const deliveries = await db
    .select({
      eventType: notificationDeliveries.eventType,
      status: notificationDeliveries.status,
      attempts: notificationDeliveries.attempts,
      sentAt: notificationDeliveries.sentAt,
      recipientName: user.name,
    })
    .from(notificationDeliveries)
    .innerJoin(user, eq(user.id, notificationDeliveries.userId))
    .where(and(eq(notificationDeliveries.incidentId, incidentId), eq(notificationDeliveries.orgId, orgId)))
    .orderBy(asc(notificationDeliveries.createdAt));

  return { ...incident, updates, deliveries };
}

export async function acknowledgeIncident(db: Database, actor: Actor, orgId: string, incidentId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "incident:write");
    if (!UUID_RE.test(incidentId)) throw notFound("Incident");
    const [current] = await tx
      .select({ status: incidents.status })
      .from(incidents)
      .where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId)))
      .for("update");
    if (!current) throw notFound("Incident");
    if (current.status === "resolved") throw conflict("This incident is already resolved");
    if (current.status === "acknowledged") return { status: "acknowledged" as const };
    await tx
      .update(incidents)
      .set({ status: "acknowledged", acknowledgedAt: now, acknowledgedBy: actor.userId, updatedAt: now })
      .where(eq(incidents.id, incidentId));
    await tx.insert(incidentUpdates).values({
      orgId,
      incidentId,
      status: "investigating",
      // No name in the message: updates can be published on status pages. The author is stored separately.
      message: "Acknowledged — the team is looking into it.",
      createdBy: actor.userId,
    });
    return { status: "acknowledged" as const };
  });
}

export const addIncidentUpdateInput = z.object({
  // Resolution is decided by the checks themselves, not declared by hand.
  status: z.enum(["investigating", "identified", "monitoring"]),
  message: z.string().trim().min(1).max(5000),
});

export async function addIncidentUpdate(db: Database, actor: Actor, orgId: string, incidentId: string, raw: unknown) {
  const input = addIncidentUpdateInput.parse(raw);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "incident:write");
    if (!UUID_RE.test(incidentId)) throw notFound("Incident");
    const [incident] = await tx
      .select({ status: incidents.status })
      .from(incidents)
      .where(and(eq(incidents.id, incidentId), eq(incidents.orgId, orgId)));
    if (!incident) throw notFound("Incident");
    if (incident.status === "resolved") throw conflict("Updates can only be posted on active incidents");
    const [update] = await tx
      .insert(incidentUpdates)
      .values({ orgId, incidentId, status: input.status, message: input.message, createdBy: actor.userId })
      .returning();
    await tx.update(incidents).set({ updatedAt: new Date() }).where(eq(incidents.id, incidentId));
    return update!;
  });
}

// ---------------------------------------------------------------- preferences

export const notificationPreferencesInput = z
  .object({ enabled: z.boolean(), incidentOpened: z.boolean(), incidentResolved: z.boolean() })
  .partial()
  .strict();

const DEFAULT_PREFERENCES = { enabled: true, incidentOpened: true, incidentResolved: true };

/** The caller's own preferences in an organization (defaults: everything on). */
export async function getNotificationPreferences(db: Executor, actor: Actor, orgId: string) {
  await authorize(db, actor, orgId, "organization:read");
  const [row] = await db
    .select({
      enabled: notificationPreferences.enabled,
      incidentOpened: notificationPreferences.incidentOpened,
      incidentResolved: notificationPreferences.incidentResolved,
    })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.orgId, orgId), eq(notificationPreferences.userId, actor.userId)));
  return row ?? DEFAULT_PREFERENCES;
}

export async function updateNotificationPreferences(db: Executor, actor: Actor, orgId: string, raw: unknown) {
  await authorize(db, actor, orgId, "organization:read");
  const patch = notificationPreferencesInput.parse(raw);
  const [row] = await db
    .insert(notificationPreferences)
    .values({ orgId, userId: actor.userId, ...DEFAULT_PREFERENCES, ...patch })
    .onConflictDoUpdate({
      target: [notificationPreferences.orgId, notificationPreferences.userId],
      set: { ...patch, updatedAt: new Date() },
    })
    .returning({
      enabled: notificationPreferences.enabled,
      incidentOpened: notificationPreferences.incidentOpened,
      incidentResolved: notificationPreferences.incidentResolved,
    });
  return row!;
}
