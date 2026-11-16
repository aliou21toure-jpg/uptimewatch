import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations } from "./organizations";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** `recovering` is not in spec v1.0's enum; see docs/decisions/0002-spec-amendments.md (#1). */
export const monitorState = pgEnum("monitor_state", [
  "unknown",
  "healthy",
  "degraded",
  "down",
  "recovering",
  "paused",
]);
export type MonitorState = (typeof monitorState.enumValues)[number];

export const MONITOR_INTERVALS = [30, 60, 300, 600, 900, 1800, 3600] as const;

export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    url: text("url").notNull(),
    method: varchar("method", { length: 4 }).notNull().default("GET"),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    timeoutMs: integer("timeout_ms").notNull().default(10000),
    expectedStatusMin: smallint("expected_status_min").notNull().default(200),
    expectedStatusMax: smallint("expected_status_max").notNull().default(299),
    bodyContains: text("body_contains"),
    /** AES-256-GCM ciphertext of the custom headers, bound to (org_id, id). Never returned by the API. */
    headersCiphertext: bytea("headers_ciphertext"),
    /** Header names only, so the UI can list them without decrypting. */
    headerNames: text("header_names").array().notNull().default(sql`'{}'::text[]`),
    enabled: boolean("enabled").notNull().default(true),
    state: monitorState("state").notNull().default("unknown"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    consecutiveSuccesses: integer("consecutive_successes").notNull().default(0),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    /** Slot of the newest result applied to `state`; older results arriving late are ignored. */
    lastResultSlot: timestamp("last_result_slot", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Target of composite foreign keys (checks, incidents, status pages) that pin rows to one organization.
    unique("monitors_org_id_id_unique").on(t.orgId, t.id),
    check("monitors_method", sql`${t.method} IN ('GET', 'HEAD')`),
    check("monitors_interval", sql`${t.intervalSeconds} IN (30, 60, 300, 600, 900, 1800, 3600)`),
    check("monitors_timeout_range", sql`${t.timeoutMs} BETWEEN 1000 AND 30000`),
    check("monitors_timeout_below_interval", sql`${t.timeoutMs} < ${t.intervalSeconds} * 1000`),
    check("monitors_status_min", sql`${t.expectedStatusMin} BETWEEN 100 AND 599`),
    check("monitors_status_max", sql`${t.expectedStatusMax} BETWEEN ${t.expectedStatusMin} AND 599`),
    // HEAD responses have no body, so a keyword check is only valid with GET (spec amendment #3).
    check("monitors_body_requires_get", sql`${t.method} = 'GET' OR ${t.bodyContains} IS NULL`),
    check("monitors_counters", sql`${t.consecutiveFailures} >= 0 AND ${t.consecutiveSuccesses} >= 0`),
    check(
      "monitors_paused_consistency",
      sql`(${t.enabled} AND ${t.state} <> 'paused') OR (NOT ${t.enabled} AND ${t.state} = 'paused')`,
    ),
    check("monitors_url_scheme", sql`${t.url} ~* '^https?://'`),
    index("monitors_due_idx").on(t.nextCheckAt).where(sql`${t.enabled} = TRUE`),
    index("monitors_org_created_idx").on(t.orgId, t.createdAt.desc(), t.id.desc()),
  ],
);
