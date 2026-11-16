import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { monitors } from "./monitors";
import { organizations } from "./organizations";

export const incidentStatus = pgEnum("incident_status", ["open", "acknowledged", "resolved"]);
export const incidentSeverity = pgEnum("incident_severity", ["minor", "major", "critical"]);
export const incidentUpdateStatus = pgEnum("incident_update_status", ["investigating", "identified", "monitoring", "resolved"]);
export const deliveryStatus = pgEnum("delivery_status", ["pending", "sent", "failed"]);
export type IncidentStatus = (typeof incidentStatus.enumValues)[number];
export type IncidentUpdateStatus = (typeof incidentUpdateStatus.enumValues)[number];

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    monitorId: uuid("monitor_id").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    status: incidentStatus("status").notNull().default("open"),
    severity: incidentSeverity("severity").notNull().default("major"),
    /** Start of the outage: the first failed check of the streak (spec amendment #2). */
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    /** When the outage was confirmed (second consecutive failure). */
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    causeCode: varchar("cause_code", { length: 80 }),
    causeMessage: varchar("cause_message", { length: 500 }),
    failedCheckCount: integer("failed_check_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("incidents_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.monitorId], foreignColumns: [monitors.orgId, monitors.id] }).onDelete("cascade"),
    // At most one active incident per monitor (spec §2.4).
    uniqueIndex("incidents_one_active_per_monitor").on(t.monitorId).where(sql`${t.status} IN ('open', 'acknowledged')`),
    index("incidents_org_history_idx").on(t.orgId, t.openedAt.desc(), t.id.desc()),
    index("incidents_monitor_history_idx").on(t.monitorId, t.openedAt.desc()),
    check("incidents_resolved_consistency", sql`(${t.status} = 'resolved') = (${t.resolvedAt} IS NOT NULL)`),
  ],
);

export const incidentUpdates = pgTable(
  "incident_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    status: incidentUpdateStatus("status").notNull(),
    message: text("message").notNull(),
    /** Null for updates written by the platform itself. */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.incidentId], foreignColumns: [incidents.orgId, incidents.id] }).onDelete("cascade"),
    index("incident_updates_incident_idx").on(t.incidentId, t.createdAt),
    check("incident_updates_message_length", sql`char_length(${t.message}) BETWEEN 1 AND 5000`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    incidentOpened: boolean("incident_opened").notNull().default(true),
    incidentResolved: boolean("incident_resolved").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("notification_preferences_org_user_unique").on(t.orgId, t.userId)],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 40 }).notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.incidentId], foreignColumns: [incidents.orgId, incidents.id] }).onDelete("cascade"),
    // One email per person and event: the idempotency guarantee of spec §2.5.
    unique("notification_deliveries_once").on(t.incidentId, t.userId, t.eventType),
    index("notification_deliveries_due_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  ],
);
