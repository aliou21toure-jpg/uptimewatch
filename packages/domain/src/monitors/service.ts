import { getEncryptionKey } from "@uptimewatch/config";
import { schema, type Database, type Executor } from "@uptimewatch/db";
import { and, count, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { DomainError, notFound } from "../errors";
import { closeActiveIncident } from "../incidents/engine";
import { authorize, type Actor } from "../organizations/service";
import { open, seal } from "../security/secret-box";
import {
  createMonitorInput,
  crossFieldIssues,
  listMonitorsQuery,
  updateMonitorInput,
} from "./schemas";

const { monitors } = schema;

export const MAX_MONITORS_PER_ORGANIZATION = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MonitorRow = typeof monitors.$inferSelect;
type Header = { name: string; value: string };

const aad = (orgId: string, monitorId: string) => `monitor-headers:${orgId}:${monitorId}`;

function encryptHeaders(orgId: string, monitorId: string, headers: Header[]) {
  if (headers.length === 0) return { headersCiphertext: null, headerNames: [] as string[] };
  return {
    headersCiphertext: seal(JSON.stringify(headers), getEncryptionKey(), aad(orgId, monitorId)),
    headerNames: headers.map((h) => h.name),
  };
}

/** For the check engine (Phase 4) only — header values never leave the server through the API. */
export function decryptMonitorHeaders(row: Pick<MonitorRow, "orgId" | "id" | "headersCiphertext">): Header[] {
  if (!row.headersCiphertext) return [];
  return JSON.parse(open(row.headersCiphertext, getEncryptionKey(), aad(row.orgId, row.id))) as Header[];
}

/** Public representation: secrets stripped, header values replaced by their names. */
export function toMonitorDto(row: MonitorRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    url: row.url,
    method: row.method as "GET" | "HEAD",
    intervalSeconds: row.intervalSeconds,
    timeoutMs: row.timeoutMs,
    expectedStatusMin: row.expectedStatusMin,
    expectedStatusMax: row.expectedStatusMax,
    bodyContains: row.bodyContains,
    headerNames: row.headerNames,
    enabled: row.enabled,
    state: row.state,
    nextCheckAt: row.nextCheckAt,
    lastCheckedAt: row.lastCheckedAt,
    lastSuccessAt: row.lastSuccessAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export type MonitorDto = ReturnType<typeof toMonitorDto>;

export async function createMonitor(db: Database, actor: Actor, orgId: string, raw: unknown, now = new Date()) {
  const input = createMonitorInput.parse(raw);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "monitor:write");
    // Serialize creations per organization so the quota cannot be exceeded by concurrent requests.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`monitors:${orgId}`}, 0))`);
    const [{ value } = { value: 0 }] = await tx.select({ value: count() }).from(monitors).where(eq(monitors.orgId, orgId));
    if (value >= MAX_MONITORS_PER_ORGANIZATION) {
      throw new DomainError("RATE_LIMITED", `An organization can have at most ${MAX_MONITORS_PER_ORGANIZATION} monitors`);
    }
    const id = randomUUID();
    const { headers, ...fields } = input;
    const [row] = await tx
      .insert(monitors)
      .values({
        id,
        orgId,
        ...fields,
        ...encryptHeaders(orgId, id, headers),
        createdBy: actor.userId,
        // The first check is due immediately; the scheduler (Phase 3) picks it up.
        nextCheckAt: now,
      })
      .returning();
    return toMonitorDto(row!);
  });
}

async function loadForUpdate(tx: Executor, orgId: string, monitorId: string) {
  if (!UUID_RE.test(monitorId)) throw notFound("Monitor");
  const [row] = await tx
    .select()
    .from(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.orgId, orgId)))
    .for("update");
  if (!row) throw notFound("Monitor");
  return row;
}

export async function getMonitor(db: Executor, actor: Actor, orgId: string, monitorId: string) {
  await authorize(db, actor, orgId, "monitor:read");
  if (!UUID_RE.test(monitorId)) throw notFound("Monitor");
  const [row] = await db.select().from(monitors).where(and(eq(monitors.id, monitorId), eq(monitors.orgId, orgId)));
  if (!row) throw notFound("Monitor");
  return toMonitorDto(row);
}

export async function updateMonitor(db: Database, actor: Actor, orgId: string, monitorId: string, raw: unknown) {
  const patch = updateMonitorInput.parse(raw);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "monitor:write");
    const current = await loadForUpdate(tx, orgId, monitorId);
    const merged = {
      method: (patch.method ?? current.method) as "GET" | "HEAD",
      intervalSeconds: patch.intervalSeconds ?? current.intervalSeconds,
      timeoutMs: patch.timeoutMs ?? current.timeoutMs,
      expectedStatusMin: patch.expectedStatusMin ?? current.expectedStatusMin,
      expectedStatusMax: patch.expectedStatusMax ?? current.expectedStatusMax,
      bodyContains: patch.bodyContains === undefined ? current.bodyContains : patch.bodyContains,
    };
    const issues = crossFieldIssues(merged);
    if (issues.length) {
      throw new ZodError(issues.map((i) => ({ code: "custom" as const, path: [i.path], message: i.message, input: undefined })));
    }

    const { headers, ...changes } = patch;
    const targetChanged = patch.url !== undefined && patch.url !== current.url;
    const [row] = await tx
      .update(monitors)
      .set({
        ...changes,
        ...(headers !== undefined ? encryptHeaders(orgId, monitorId, headers) : {}),
        // A new target starts from a clean slate: previous results described another endpoint.
        ...(targetChanged && current.enabled
          ? { state: "unknown" as const, consecutiveFailures: 0, consecutiveSuccesses: 0, failingSince: null, nextCheckAt: new Date() }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(monitors.id, monitorId), eq(monitors.orgId, orgId)))
      .returning();
    if (targetChanged && current.enabled) {
      await closeActiveIncident(tx, orgId, monitorId, new Date(), actor.userId, "The monitored URL changed; the incident was closed.");
    }
    return toMonitorDto(row!);
  });
}

export async function pauseMonitor(db: Database, actor: Actor, orgId: string, monitorId: string) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "monitor:write");
    const current = await loadForUpdate(tx, orgId, monitorId);
    if (!current.enabled) return toMonitorDto(current);
    const now = new Date();
    const [row] = await tx
      .update(monitors)
      .set({ enabled: false, state: "paused", nextCheckAt: null, failingSince: null, updatedAt: now })
      .where(eq(monitors.id, monitorId))
      .returning();
    await closeActiveIncident(tx, orgId, monitorId, now, actor.userId, "Monitoring was paused; the incident was closed without confirming recovery.");
    return toMonitorDto(row!);
  });
}

export async function resumeMonitor(db: Database, actor: Actor, orgId: string, monitorId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "monitor:write");
    const current = await loadForUpdate(tx, orgId, monitorId);
    if (current.enabled) return toMonitorDto(current);
    const [row] = await tx
      .update(monitors)
      .set({
        enabled: true,
        state: "unknown",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        nextCheckAt: now,
        updatedAt: now,
      })
      .where(eq(monitors.id, monitorId))
      .returning();
    return toMonitorDto(row!);
  });
}

export async function deleteMonitor(db: Database, actor: Actor, orgId: string, monitorId: string) {
  await authorize(db, actor, orgId, "monitor:write");
  if (!UUID_RE.test(monitorId)) throw notFound("Monitor");
  const deleted = await db
    .delete(monitors)
    .where(and(eq(monitors.id, monitorId), eq(monitors.orgId, orgId)))
    .returning({ id: monitors.id });
  if (deleted.length === 0) throw notFound("Monitor");
}

// ------------------------------------------------------------------ listing

const encodeCursor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || !UUID_RE.test(id)) throw new Error();
    return { createdAt: date, id };
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Invalid cursor");
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Newest first, keyset-paginated on (created_at, id) so pages stay stable while rows are added. */
export async function listMonitors(db: Executor, actor: Actor, orgId: string, rawQuery: unknown) {
  await authorize(db, actor, orgId, "monitor:read");
  const query = listMonitorsQuery.parse(rawQuery);
  const filters: SQL[] = [eq(monitors.orgId, orgId)];
  if (query.state) filters.push(eq(monitors.state, query.state));
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    filters.push(or(ilike(monitors.name, pattern), ilike(monitors.url, pattern))!);
  }
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    filters.push(
      or(lt(monitors.createdAt, c.createdAt), and(eq(monitors.createdAt, c.createdAt), lt(monitors.id, c.id)))!,
    );
  }
  const rows = await db
    .select()
    .from(monitors)
    .where(and(...filters))
    .orderBy(desc(monitors.createdAt), desc(monitors.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    data: page.map(toMonitorDto),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

export async function monitorSummary(db: Executor, actor: Actor, orgId: string) {
  await authorize(db, actor, orgId, "monitor:read");
  const rows = await db
    .select({ state: monitors.state, value: count() })
    .from(monitors)
    .where(eq(monitors.orgId, orgId))
    .groupBy(monitors.state);
  const byState = Object.fromEntries(rows.map((r) => [r.state, r.value])) as Partial<Record<MonitorRow["state"], number>>;
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return { total, active: total - (byState.paused ?? 0), byState };
}
