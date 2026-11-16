import { schema, type Executor } from "@uptimewatch/db";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { DomainError, notFound } from "../errors";
import { authorize, type Actor } from "../organizations/service";

const { monitorChecks, monitors } = schema;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RANGE_MS = 31 * 24 * 3600_000;

export const listChecksQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  state: z.enum(["queued", "running", "up", "down", "error", "skipped"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().max(100).optional(),
});

/** Check history of one monitor, newest first, within a time range (default: last 24 hours). */
export async function listChecks(db: Executor, actor: Actor, orgId: string, monitorId: string, raw: unknown, now = new Date()) {
  await authorize(db, actor, orgId, "monitor:read");
  if (!UUID_RE.test(monitorId)) throw notFound("Monitor");
  const q = listChecksQuery.parse(raw);
  const to = q.to ?? now;
  const from = q.from ?? new Date(to.getTime() - 24 * 3600_000);
  if (from > to) throw new DomainError("VALIDATION_ERROR", "`from` must be before `to`");
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new DomainError("VALIDATION_ERROR", "The time range is limited to 31 days");

  const [monitor] = await db.select({ id: monitors.id }).from(monitors).where(and(eq(monitors.id, monitorId), eq(monitors.orgId, orgId)));
  if (!monitor) throw notFound("Monitor");

  let before: Date | null = null;
  if (q.cursor) {
    before = new Date(Buffer.from(q.cursor, "base64url").toString("utf8"));
    if (Number.isNaN(before.getTime())) throw new DomainError("VALIDATION_ERROR", "Invalid cursor");
  }

  const rows = await db
    .select({
      id: monitorChecks.id,
      scheduledFor: monitorChecks.scheduledFor,
      state: monitorChecks.state,
      httpStatus: monitorChecks.httpStatus,
      latencyMs: monitorChecks.latencyMs,
      errorCode: monitorChecks.errorCode,
      errorMessage: monitorChecks.errorMessage,
      startedAt: monitorChecks.startedAt,
      finishedAt: monitorChecks.finishedAt,
    })
    .from(monitorChecks)
    .where(
      and(
        eq(monitorChecks.orgId, orgId), // tenant scope on the check rows themselves
        eq(monitorChecks.monitorId, monitorId),
        gte(monitorChecks.scheduledFor, from), // range predicates prune partitions
        lte(monitorChecks.scheduledFor, to),
        ...(q.state ? [eq(monitorChecks.state, q.state)] : []),
        ...(before ? [lt(monitorChecks.scheduledFor, before)] : []),
      ),
    )
    .orderBy(desc(monitorChecks.scheduledFor))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    data: page,
    nextCursor: rows.length > q.limit && last ? Buffer.from(last.scheduledFor.toISOString()).toString("base64url") : null,
    range: { from, to },
  };
}
