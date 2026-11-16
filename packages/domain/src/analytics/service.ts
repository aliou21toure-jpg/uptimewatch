import { schema, type Executor } from "@uptimewatch/db";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { notFound } from "../errors";
import { authorize, type Actor } from "../organizations/service";

const { incidents, monitors } = schema;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

export interface WindowStats {
  /** up / (up + down) in %, null when there is no verdict in the window. */
  uptime: number | null;
  /** Checks with a verdict on the service. */
  checks: number;
  failedChecks: number;
  /** Share of planned checks the platform actually executed, in %. */
  coverage: number | null;
  avgLatencyMs: number | null;
  /** Exact percentiles; only for the 24 h window (computed from raw checks). */
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  incidents: number;
  downtimeSeconds: number;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Rolling 24 h, exact, from raw checks (partition-pruned by the time predicate). */
async function rawWindow(db: Executor, orgId: string, monitorFilter: SQL, from: Date, to: Date) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT
      count(*) FILTER (WHERE state IN ('up', 'down'))::int AS checks,
      count(*) FILTER (WHERE state = 'down')::int AS failed,
      100.0 * count(*) FILTER (WHERE state = 'up') / NULLIF(count(*) FILTER (WHERE state IN ('up', 'down')), 0) AS uptime,
      100.0 * count(*) FILTER (WHERE state IN ('up', 'down')) / NULLIF(count(*) + COALESCE(sum(missed_slots), 0), 0) AS coverage,
      round(avg(latency_ms) FILTER (WHERE state = 'up')) AS avg,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE state = 'up')) AS p50,
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE state = 'up')) AS p95
    FROM monitor_checks
    WHERE org_id = ${orgId}::uuid AND ${monitorFilter}
      AND scheduled_for >= ${from.toISOString()}::timestamptz AND scheduled_for < ${to.toISOString()}::timestamptz
      AND state NOT IN ('queued', 'running')
  `);
  return rows[0]!;
}

/**
 * Per-monitor, per-day rows for [fromDay, today]: past days come from the daily aggregates, today
 * is computed live from raw checks, so 7/30-day figures always agree with the live 24 h window.
 */
function dayRows(orgId: string, monitorFilter: SQL, fromDay: string, now: Date) {
  const today = utcDay(now);
  return sql`(
    SELECT day, monitor_id, successful_checks AS up, total_checks AS verdicts, failed_checks AS failed,
      platform_error_checks + skipped_checks + missed_slots AS lost,
      avg_latency_ms::numeric * successful_checks AS latency_sum, p95_latency_ms AS p95
    FROM monitor_daily_stats
    WHERE org_id = ${orgId}::uuid AND ${monitorFilter} AND day >= ${fromDay}::date AND day < ${today}::date
    UNION ALL
    SELECT ${today}::date, monitor_id,
      count(*) FILTER (WHERE state = 'up'),
      count(*) FILTER (WHERE state IN ('up', 'down')),
      count(*) FILTER (WHERE state = 'down'),
      count(*) FILTER (WHERE state IN ('error', 'skipped')) + COALESCE(sum(missed_slots), 0),
      sum(latency_ms) FILTER (WHERE state = 'up'),
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE state = 'up'))
    FROM monitor_checks
    WHERE org_id = ${orgId}::uuid AND ${monitorFilter}
      AND scheduled_for >= ${today}::date AT TIME ZONE 'UTC' AND state NOT IN ('queued', 'running')
    GROUP BY monitor_id
  )`;
}

/** 7 / 30 UTC days, today included. */
async function dailyWindow(db: Executor, orgId: string, monitorFilter: SQL, days: number, now: Date) {
  const from = utcDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT
      COALESCE(sum(verdicts), 0)::int AS checks,
      COALESCE(sum(failed), 0)::int AS failed,
      100.0 * sum(up) / NULLIF(sum(verdicts), 0) AS uptime,
      100.0 * sum(verdicts) / NULLIF(sum(verdicts + lost), 0) AS coverage,
      round(sum(latency_sum) / NULLIF(sum(up) FILTER (WHERE latency_sum IS NOT NULL), 0)) AS avg
    FROM ${dayRows(orgId, monitorFilter, from, now)} d
  `);
  return rows[0]!;
}

/** Incidents overlapping [from, to] and the downtime they account for inside it. */
async function incidentWindow(db: Executor, orgId: string, monitorFilter: SQL, from: Date, to: Date) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT
      count(*)::int AS incidents,
      COALESCE(sum(extract(epoch FROM
        LEAST(COALESCE(resolved_at, ${to.toISOString()}::timestamptz), ${to.toISOString()}::timestamptz)
        - GREATEST(opened_at, ${from.toISOString()}::timestamptz)
      )), 0)::int AS downtime
    FROM incidents
    WHERE org_id = ${orgId}::uuid AND ${monitorFilter}
      AND opened_at < ${to.toISOString()}::timestamptz
      AND COALESCE(resolved_at, 'infinity'::timestamptz) > ${from.toISOString()}::timestamptz
  `);
  return rows[0]!;
}

async function windows(db: Executor, orgId: string, monitorFilter: SQL, now: Date) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const [raw24, inc24, d7, inc7, d30, inc30] = await Promise.all([
    rawWindow(db, orgId, monitorFilter, dayAgo, now),
    incidentWindow(db, orgId, monitorFilter, dayAgo, now),
    dailyWindow(db, orgId, monitorFilter, 7, now),
    incidentWindow(db, orgId, monitorFilter, new Date(now.getTime() - 7 * DAY_MS), now),
    dailyWindow(db, orgId, monitorFilter, 30, now),
    incidentWindow(db, orgId, monitorFilter, new Date(now.getTime() - 30 * DAY_MS), now),
  ]);
  const shape = (r: Record<string, unknown>, inc: Record<string, unknown>, exact: boolean): WindowStats => ({
    uptime: num(r.uptime),
    checks: Number(r.checks),
    failedChecks: Number(r.failed),
    coverage: num(r.coverage),
    avgLatencyMs: num(r.avg),
    p50LatencyMs: exact ? num(r.p50) : null,
    p95LatencyMs: exact ? num(r.p95) : null,
    incidents: Number(inc.incidents),
    downtimeSeconds: Number(inc.downtime),
  });
  return { "24h": shape(raw24, inc24, true), "7d": shape(d7, inc7, false), "30d": shape(d30, inc30, false) };
}

/** Latency (exact percentiles) and results in 10-minute buckets over the last 24 h, oldest first. */
async function hourlySeries(db: Executor, orgId: string, monitorId: string, now: Date) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT
      date_bin('10 minutes', scheduled_for, '2000-01-01T00:00:00Z'::timestamptz) AS hour,
      count(*) FILTER (WHERE state = 'up')::int AS up,
      count(*) FILTER (WHERE state = 'down')::int AS down,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE state = 'up')) AS p50,
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE state = 'up')) AS p95
    FROM monitor_checks
    WHERE org_id = ${orgId}::uuid AND monitor_id = ${monitorId}::uuid
      AND scheduled_for >= ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamptz
      AND state NOT IN ('queued', 'running')
    GROUP BY 1 ORDER BY 1
  `);
  return rows.map((r) => ({
    hour: new Date(r.hour as string).toISOString(),
    up: Number(r.up),
    down: Number(r.down),
    p50: num(r.p50),
    p95: num(r.p95),
  }));
}

/** Last 30 UTC days, one entry per day (null when nothing ran), oldest first; today is live. */
async function dailySeries(db: Executor, orgId: string, monitorFilter: SQL, now: Date) {
  const from = utcDay(new Date(now.getTime() - 29 * DAY_MS));
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT g::date::text AS day,
      sum(d.verdicts)::int AS checks,
      sum(d.failed)::int AS failed,
      100.0 * sum(d.up) / NULLIF(sum(d.verdicts), 0) AS uptime,
      max(d.p95) AS p95
    FROM generate_series(${from}::date, ${utcDay(now)}::date, interval '1 day') g
    LEFT JOIN ${dayRows(orgId, monitorFilter, from, now)} d ON d.day = g::date
    GROUP BY g ORDER BY g
  `);
  return rows.map((r) => ({
    day: r.day as string,
    checks: Number(r.checks ?? 0),
    failed: Number(r.failed ?? 0),
    uptime: num(r.uptime),
    p95: num(r.p95),
  }));
}

export async function monitorStats(db: Executor, actor: Actor, orgId: string, monitorId: string, now = new Date()) {
  await authorize(db, actor, orgId, "monitor:read");
  if (!UUID_RE.test(monitorId)) throw notFound("Monitor");
  const [monitor] = await db.select({ id: monitors.id }).from(monitors).where(and(eq(monitors.id, monitorId), eq(monitors.orgId, orgId)));
  if (!monitor) throw notFound("Monitor");
  const filter = sql`monitor_id = ${monitorId}::uuid`;
  const [win, hourly, daily] = await Promise.all([
    windows(db, orgId, filter, now),
    hourlySeries(db, orgId, monitorId, now),
    dailySeries(db, orgId, filter, now),
  ]);
  return { windows: win, hourly, daily, generatedAt: now };
}

export async function organizationDashboard(db: Executor, actor: Actor, orgId: string, now = new Date()) {
  await authorize(db, actor, orgId, "monitor:read");
  const all = sql`TRUE`;
  const dayAgo = new Date(now.getTime() - DAY_MS);

  const [win, daily, perMonitor, events] = await Promise.all([
    windows(db, orgId, all, now),
    dailySeries(db, orgId, all, now),
    db.execute<Record<string, unknown>>(sql`
      SELECT m.id, m.name, m.url, m.state, m.enabled, m.last_checked_at,
        r.uptime AS uptime_24h, r.avg AS avg_24h, r.p95 AS p95_24h, d.uptime AS uptime_30d
      FROM monitors m
      LEFT JOIN LATERAL (
        SELECT 100.0 * count(*) FILTER (WHERE state = 'up') / NULLIF(count(*) FILTER (WHERE state IN ('up', 'down')), 0) AS uptime,
          round(avg(latency_ms) FILTER (WHERE state = 'up')) AS avg,
          round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE state = 'up')) AS p95
        FROM monitor_checks c
        WHERE c.org_id = m.org_id AND c.monitor_id = m.id
          AND c.scheduled_for >= ${dayAgo.toISOString()}::timestamptz AND c.state IN ('up', 'down')
      ) r ON TRUE
      LEFT JOIN (
        SELECT monitor_id, 100.0 * sum(up) / NULLIF(sum(verdicts), 0) AS uptime
        FROM ${dayRows(orgId, all, utcDay(new Date(now.getTime() - 29 * DAY_MS)), now)} x
        GROUP BY monitor_id
      ) d ON d.monitor_id = m.id
      WHERE m.org_id = ${orgId}::uuid
      ORDER BY CASE m.state WHEN 'down' THEN 0 WHEN 'recovering' THEN 1 WHEN 'degraded' THEN 2 ELSE 3 END, m.name
    `),
    // Latest incident events (opened / resolved), newest first.
    db
      .select({
        incidentId: incidents.id,
        monitorName: monitors.name,
        status: incidents.status,
        openedAt: incidents.openedAt,
        resolvedAt: incidents.resolvedAt,
        causeCode: incidents.causeCode,
      })
      .from(incidents)
      .innerJoin(monitors, and(eq(monitors.id, incidents.monitorId), eq(monitors.orgId, incidents.orgId)))
      .where(eq(incidents.orgId, orgId))
      .orderBy(desc(sql`COALESCE(${incidents.resolvedAt}, ${incidents.openedAt})`))
      .limit(8),
  ]);

  const monitorsRows = perMonitor.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    url: r.url as string,
    state: r.state as (typeof schema.monitorState.enumValues)[number],
    enabled: r.enabled as boolean,
    lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at as string) : null,
    uptime24h: num(r.uptime_24h),
    uptime30d: num(r.uptime_30d),
    avgLatency24h: num(r.avg_24h),
    p95Latency24h: num(r.p95_24h),
  }));

  const openIncidents = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(eq(incidents.orgId, orgId), inArray(incidents.status, ["open", "acknowledged"])));

  return {
    windows: win,
    daily,
    monitors: monitorsRows,
    counts: {
      total: monitorsRows.length,
      active: monitorsRows.filter((m) => m.enabled).length,
      down: monitorsRows.filter((m) => m.state === "down").length,
      openIncidents: openIncidents.length,
    },
    events: events.flatMap((e) => [
      ...(e.resolvedAt ? [{ type: "resolved" as const, at: e.resolvedAt, incidentId: e.incidentId, monitorName: e.monitorName, causeCode: e.causeCode }] : []),
      { type: "opened" as const, at: e.openedAt, incidentId: e.incidentId, monitorName: e.monitorName, causeCode: e.causeCode },
    ])
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 8),
    generatedAt: now,
  };
}
