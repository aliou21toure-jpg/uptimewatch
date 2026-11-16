import { getEmailEnv } from "@uptimewatch/config";
import { schema, type Database } from "@uptimewatch/db";
import { actionEmail, type EmailMessage, type EmailSender } from "@uptimewatch/email";
import { ERROR_LABELS, type CheckErrorCode } from "@uptimewatch/monitoring";
import { and, eq, sql } from "drizzle-orm";

const { incidents, monitors, notificationDeliveries, organizations, user } = schema;

export type IncidentEventType = "incident.opened" | "incident.resolved";

export const MAX_DELIVERY_ATTEMPTS = 5;
/** 30 s, 1 min, 2 min, 4 min… capped at 1 h. */
export const deliveryBackoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
/** A claimed delivery is retried by the sweep if the sender crashed before recording the outcome. */
const CLAIM_MS = 2 * 60_000;

/**
 * Creates one pending delivery per member who wants this kind of alert. Idempotent: the unique
 * (incident, user, event) constraint makes re-running the fan-out a no-op.
 */
export async function fanOutIncidentEvent(
  db: Database,
  event: { incidentId: string; orgId: string; eventType: IncidentEventType },
): Promise<number> {
  const preferenceColumn = event.eventType === "incident.opened" ? "incident_opened" : "incident_resolved";
  const result = await db.execute(sql`
    INSERT INTO notification_deliveries (org_id, incident_id, user_id, event_type)
    SELECT m.org_id, ${event.incidentId}::uuid, m.user_id, ${event.eventType}
    FROM organization_members m
    JOIN "user" u ON u.id = m.user_id AND u.email_verified
    LEFT JOIN notification_preferences p ON p.org_id = m.org_id AND p.user_id = m.user_id
    WHERE m.org_id = ${event.orgId}::uuid
      AND EXISTS (SELECT 1 FROM incidents i WHERE i.id = ${event.incidentId}::uuid AND i.org_id = m.org_id)
      AND COALESCE(p.enabled, TRUE)
      AND COALESCE(${sql.raw(`p.${preferenceColumn}`)}, TRUE)
    ON CONFLICT (incident_id, user_id, event_type) DO NOTHING
  `);
  return result.rowCount ?? 0;
}

const formatUtc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export interface IncidentEmailContext {
  eventType: string;
  to: string;
  organizationName: string;
  monitorName: string;
  monitorUrl: string;
  incidentUrl: string;
  openedAt: Date;
  resolvedAt: Date | null;
  causeCode: string | null;
  causeMessage: string | null;
}

export function renderIncidentEmail(c: IncidentEmailContext): EmailMessage {
  if (c.eventType === "incident.resolved") {
    const duration = c.resolvedAt ? formatDuration(c.resolvedAt.getTime() - c.openedAt.getTime()) : null;
    return actionEmail({
      to: c.to,
      subject: `[Resolved] ${c.monitorName} is back up`,
      intro: `${c.monitorName} (${c.organizationName}) is responding normally again${duration ? ` after ${duration} of downtime` : ""}. Started ${formatUtc(c.openedAt)}${c.resolvedAt ? `, resolved ${formatUtc(c.resolvedAt)}` : ""}.`,
      actionLabel: "View the incident",
      url: c.incidentUrl,
      outro: "You receive this because you are a member of this organization. Change your alerts in Settings → Notifications.",
    });
  }
  const cause = c.causeCode ? (ERROR_LABELS[c.causeCode as CheckErrorCode] ?? c.causeCode) : "Check failed";
  return actionEmail({
    to: c.to,
    subject: `[Down] ${c.monitorName} — ${cause}`,
    intro: `${c.monitorName} (${c.organizationName}) is down since ${formatUtc(c.openedAt)}. Cause: ${c.causeMessage ?? cause}. Monitored URL: ${c.monitorUrl}.`,
    actionLabel: "View the incident",
    url: c.incidentUrl,
    outro: "You receive this because you are a member of this organization. Change your alerts in Settings → Notifications.",
  });
}

export interface SendResult {
  sent: number;
  retrying: number;
  failed: number;
}

/**
 * Sends due pending deliveries. Each delivery is claimed (SKIP LOCKED + short claim), so several
 * workers can sweep concurrently without sending the same email twice; the delivery id is also the
 * provider's idempotency key, which covers a crash between "provider accepted" and "marked sent".
 */
export async function sendDueDeliveries(
  db: Database,
  sender: EmailSender,
  { now = new Date(), limit = 50, incidentId }: { now?: Date; limit?: number; incidentId?: string } = {},
): Promise<SendResult> {
  const claimed = await db.execute<{ id: string; attempts: number }>(sql`
    UPDATE notification_deliveries d
    SET attempts = d.attempts + 1, next_attempt_at = ${new Date(now.getTime() + CLAIM_MS).toISOString()}::timestamptz
    WHERE d.id IN (
      SELECT id FROM notification_deliveries
      WHERE status = 'pending' AND next_attempt_at <= ${now.toISOString()}::timestamptz
        ${incidentId ? sql`AND incident_id = ${incidentId}::uuid` : sql``}
      ORDER BY next_attempt_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING d.id, d.attempts
  `);

  const result: SendResult = { sent: 0, retrying: 0, failed: 0 };
  const appUrl = getEmailEnv().APP_URL;

  for (const { id, attempts } of claimed.rows) {
    const [row] = await db
      .select({
        eventType: notificationDeliveries.eventType,
        orgId: notificationDeliveries.orgId,
        incidentId: notificationDeliveries.incidentId,
        to: user.email,
        organizationName: organizations.name,
        monitorName: monitors.name,
        monitorUrl: monitors.url,
        openedAt: incidents.openedAt,
        resolvedAt: incidents.resolvedAt,
        causeCode: incidents.causeCode,
        causeMessage: incidents.causeMessage,
      })
      .from(notificationDeliveries)
      .innerJoin(user, eq(user.id, notificationDeliveries.userId))
      .innerJoin(incidents, and(eq(incidents.id, notificationDeliveries.incidentId), eq(incidents.orgId, notificationDeliveries.orgId)))
      .innerJoin(monitors, and(eq(monitors.id, incidents.monitorId), eq(monitors.orgId, incidents.orgId)))
      .innerJoin(organizations, eq(organizations.id, incidents.orgId))
      .where(eq(notificationDeliveries.id, id));
    if (!row) continue;

    try {
      const message = renderIncidentEmail({
        ...row,
        incidentUrl: new URL(`/app/${row.orgId}/incidents/${row.incidentId}`, appUrl).toString(),
      });
      const { id: providerMessageId } = await sender.send(message, { idempotencyKey: `delivery-${id}` });
      await db
        .update(notificationDeliveries)
        .set({ status: "sent", sentAt: new Date(), providerMessageId, lastError: null })
        .where(eq(notificationDeliveries.id, id));
      result.sent++;
    } catch (error) {
      const giveUp = attempts >= MAX_DELIVERY_ATTEMPTS;
      await db
        .update(notificationDeliveries)
        .set({
          status: giveUp ? "failed" : "pending",
          nextAttemptAt: new Date(now.getTime() + deliveryBackoffMs(attempts)),
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        })
        .where(eq(notificationDeliveries.id, id));
      if (giveUp) result.failed++;
      else result.retrying++;
    }
  }
  return result;
}
