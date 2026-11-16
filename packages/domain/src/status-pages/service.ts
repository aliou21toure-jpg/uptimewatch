import { schema, type Database, type Executor } from "@uptimewatch/db";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { DomainError, conflict, notFound } from "../errors";
import { slugSchema } from "../organizations/schemas";
import { authorize, type Actor } from "../organizations/service";

const { incidentUpdates, incidents, monitors, statusPageMonitors, statusPages } = schema;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
export const MAX_STATUS_PAGES_PER_ORGANIZATION = 10;
export const MAX_COMPONENTS = 50;
/** Paths a slug must not take over. */
const RESERVED_SLUGS = new Set(["admin", "api", "app", "login", "status", "new", "settings", "www", "uptimewatch"]);

const statusPageSlug = slugSchema.refine((s) => !RESERVED_SLUGS.has(s), "is reserved");

export const createStatusPageInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    slug: statusPageSlug,
    description: z.string().trim().max(1000).nullable().default(null),
    isPublic: z.boolean().default(true),
  })
  .strict();

export const updateStatusPageInput = createStatusPageInput.partial().strict();

export const setComponentsInput = z
  .array(
    z.object({
      monitorId: z.string().regex(UUID_RE, "is not a valid id"),
      displayName: z.string().trim().min(1).max(120).nullable().default(null),
    }),
  )
  .max(MAX_COMPONENTS)
  .refine((list) => new Set(list.map((c) => c.monitorId)).size === list.length, "each monitor can only appear once");

const isSlugTaken = (error: unknown) => {
  const e = ((error as { cause?: unknown })?.cause ?? error) as { code?: string; constraint?: string };
  return e?.code === "23505" && e.constraint === "status_pages_slug_unique";
};

async function loadPage(db: Executor, orgId: string, pageId: string) {
  if (!UUID_RE.test(pageId)) throw notFound("Status page");
  const [page] = await db.select().from(statusPages).where(and(eq(statusPages.id, pageId), eq(statusPages.orgId, orgId)));
  if (!page) throw notFound("Status page");
  return page;
}

export async function listStatusPages(db: Executor, actor: Actor, orgId: string) {
  await authorize(db, actor, orgId, "status-page:read");
  return db
    .select({
      id: statusPages.id,
      slug: statusPages.slug,
      title: statusPages.title,
      isPublic: statusPages.isPublic,
      updatedAt: statusPages.updatedAt,
      // Fully qualified on purpose: an unqualified "id" here would bind to the subquery's own table.
      components: sql<number>`(SELECT count(*)::int FROM status_page_monitors c WHERE c.status_page_id = "status_pages"."id")`,
    })
    .from(statusPages)
    .where(eq(statusPages.orgId, orgId))
    .orderBy(asc(statusPages.title));
}

export async function getStatusPage(db: Executor, actor: Actor, orgId: string, pageId: string) {
  await authorize(db, actor, orgId, "status-page:read");
  const page = await loadPage(db, orgId, pageId);
  const components = await db
    .select({
      monitorId: statusPageMonitors.monitorId,
      displayName: statusPageMonitors.displayName,
      sortOrder: statusPageMonitors.sortOrder,
      monitorName: monitors.name,
      state: monitors.state,
    })
    .from(statusPageMonitors)
    .innerJoin(monitors, and(eq(monitors.id, statusPageMonitors.monitorId), eq(monitors.orgId, statusPageMonitors.orgId)))
    .where(and(eq(statusPageMonitors.statusPageId, pageId), eq(statusPageMonitors.orgId, orgId)))
    .orderBy(asc(statusPageMonitors.sortOrder));
  return { ...page, components };
}

export async function createStatusPage(db: Database, actor: Actor, orgId: string, raw: unknown) {
  const input = createStatusPageInput.parse(raw);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "status-page:write");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`status-pages:${orgId}`}, 0))`);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(statusPages)
      .where(eq(statusPages.orgId, orgId));
    if (n >= MAX_STATUS_PAGES_PER_ORGANIZATION) {
      throw new DomainError("RATE_LIMITED", `An organization can have at most ${MAX_STATUS_PAGES_PER_ORGANIZATION} status pages`);
    }
    try {
      const [page] = await tx.insert(statusPages).values({ orgId, ...input }).returning();
      return page!;
    } catch (error) {
      if (isSlugTaken(error)) throw conflict("This URL is already taken");
      throw error;
    }
  });
}

/** Returns the page and the slugs whose public URL must be refreshed. */
export async function updateStatusPage(db: Database, actor: Actor, orgId: string, pageId: string, raw: unknown) {
  const patch = updateStatusPageInput.parse(raw);
  await authorize(db, actor, orgId, "status-page:write");
  const current = await loadPage(db, orgId, pageId);
  try {
    const [page] = await db
      .update(statusPages)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(statusPages.id, pageId), eq(statusPages.orgId, orgId)))
      .returning();
    return { page: page!, affectedSlugs: [...new Set([current.slug, page!.slug])] };
  } catch (error) {
    if (isSlugTaken(error)) throw conflict("This URL is already taken");
    throw error;
  }
}

export async function deleteStatusPage(db: Database, actor: Actor, orgId: string, pageId: string) {
  await authorize(db, actor, orgId, "status-page:write");
  const page = await loadPage(db, orgId, pageId);
  await db.delete(statusPages).where(and(eq(statusPages.id, pageId), eq(statusPages.orgId, orgId)));
  return { affectedSlugs: [page.slug] };
}

/** Replaces the page's components, in the given order. */
export async function setStatusPageComponents(db: Database, actor: Actor, orgId: string, pageId: string, raw: unknown) {
  const components = setComponentsInput.parse(raw);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "status-page:write");
    const page = await loadPage(tx, orgId, pageId);
    if (components.length) {
      const owned = await tx
        .select({ id: monitors.id })
        .from(monitors)
        .where(and(eq(monitors.orgId, orgId), inArray(monitors.id, components.map((c) => c.monitorId))));
      // Same answer for "does not exist" and "belongs to someone else".
      if (owned.length !== components.length) throw notFound("Monitor");
    }
    await tx.delete(statusPageMonitors).where(and(eq(statusPageMonitors.statusPageId, pageId), eq(statusPageMonitors.orgId, orgId)));
    if (components.length) {
      await tx.insert(statusPageMonitors).values(
        components.map((c, i) => ({ orgId, statusPageId: pageId, monitorId: c.monitorId, displayName: c.displayName, sortOrder: i })),
      );
    }
    await tx.update(statusPages).set({ updatedAt: new Date() }).where(eq(statusPages.id, pageId));
    return { affectedSlugs: [page.slug] };
  });
}

// ------------------------------------------------------------------ public projection

export type PublicComponentStatus = "operational" | "degraded" | "outage" | "maintenance" | "unknown";
export type OverallStatus = "operational" | "degraded" | "partial_outage" | "major_outage" | "unknown";

const COMPONENT_STATUS: Record<string, PublicComponentStatus> = {
  healthy: "operational",
  degraded: "degraded",
  recovering: "degraded",
  down: "outage",
  paused: "maintenance",
  unknown: "unknown",
};

export function overallStatus(statuses: PublicComponentStatus[]): OverallStatus {
  const watched = statuses.filter((s) => s !== "maintenance" && s !== "unknown");
  if (watched.length === 0) return "unknown";
  const down = watched.filter((s) => s === "outage").length;
  if (down === watched.length) return "major_outage";
  if (down > 0) return "partial_outage";
  if (watched.some((s) => s === "degraded")) return "degraded";
  return "operational";
}

/**
 * Everything a public status page shows, built from an allow-list of fields: component names
 * (display name, or the monitor name), public status, uptime, and incident timelines.
 * Never included: monitor URLs, methods, headers, keywords, ids, error details or author names.
 */
export async function getPublicStatusPage(db: Executor, slug: string, now = new Date()) {
  if (!statusPageSlug.safeParse(slug).success) return null;
  const [page] = await db
    .select({ id: statusPages.id, orgId: statusPages.orgId, title: statusPages.title, description: statusPages.description, updatedAt: statusPages.updatedAt })
    .from(statusPages)
    .where(and(eq(statusPages.slug, slug), eq(statusPages.isPublic, true)));
  if (!page) return null;
  return buildPublicView(db, page, now);
}

/** Same projection for members previewing a page (including a private one). */
export async function previewStatusPage(db: Executor, actor: Actor, orgId: string, pageId: string, now = new Date()) {
  await authorize(db, actor, orgId, "status-page:read");
  const page = await loadPage(db, orgId, pageId);
  return buildPublicView(db, page, now);
}

async function buildPublicView(
  db: Executor,
  page: { id: string; orgId: string; title: string; description: string | null; updatedAt: Date },
  now: Date,
) {
  const rows = await db
    .select({
      monitorId: statusPageMonitors.monitorId,
      name: sql<string>`COALESCE(${statusPageMonitors.displayName}, ${monitors.name})`,
      state: monitors.state,
    })
    .from(statusPageMonitors)
    .innerJoin(monitors, and(eq(monitors.id, statusPageMonitors.monitorId), eq(monitors.orgId, statusPageMonitors.orgId)))
    .where(and(eq(statusPageMonitors.statusPageId, page.id), eq(statusPageMonitors.orgId, page.orgId)))
    .orderBy(asc(statusPageMonitors.sortOrder));

  const ids = rows.map((r) => r.monitorId);
  const since = new Date(now.getTime() - 89 * DAY_MS).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  // 90 days of daily uptime per component: aggregates for past days, raw checks for today.
  const daily = ids.length
    ? (
        await db.execute<{ monitor_id: string; day: string; up: number; verdicts: number }>(sql`
          SELECT monitor_id, day::text AS day, successful_checks AS up, total_checks AS verdicts
          FROM monitor_daily_stats
          WHERE org_id = ${page.orgId}::uuid AND monitor_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
            AND day >= ${since}::date AND day < ${today}::date
          UNION ALL
          SELECT monitor_id, ${today}, count(*) FILTER (WHERE state = 'up')::int, count(*) FILTER (WHERE state IN ('up', 'down'))::int
          FROM monitor_checks
          WHERE org_id = ${page.orgId}::uuid AND monitor_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
            AND scheduled_for >= ${today}::date AT TIME ZONE 'UTC' AND state IN ('up', 'down')
          GROUP BY monitor_id
        `)
      ).rows
    : [];

  const days = Array.from({ length: 90 }, (_, i) => new Date(now.getTime() - (89 - i) * DAY_MS).toISOString().slice(0, 10));
  const components = rows.map((r) => {
    const mine = daily.filter((d) => d.monitor_id === r.monitorId);
    const byDay = new Map(mine.map((d) => [d.day, d]));
    const up = mine.reduce((s, d) => s + Number(d.up), 0);
    const verdicts = mine.reduce((s, d) => s + Number(d.verdicts), 0);
    return {
      name: r.name,
      status: COMPONENT_STATUS[r.state] ?? "unknown",
      uptime90d: verdicts ? (100 * up) / verdicts : null,
      days: days.map((day) => {
        const d = byDay.get(day);
        return { day, uptime: d && Number(d.verdicts) ? (100 * Number(d.up)) / Number(d.verdicts) : null };
      }),
    };
  });

  const nameByMonitor = new Map(rows.map((r) => [r.monitorId, r.name]));
  const recent = ids.length
    ? await db
        .select({
          id: incidents.id,
          monitorId: incidents.monitorId,
          status: incidents.status,
          openedAt: incidents.openedAt,
          resolvedAt: incidents.resolvedAt,
        })
        .from(incidents)
        .where(
          and(
            eq(incidents.orgId, page.orgId),
            inArray(incidents.monitorId, ids),
            or(isNull(incidents.resolvedAt), gte(incidents.resolvedAt, new Date(now.getTime() - 14 * DAY_MS)))!,
          ),
        )
        .orderBy(desc(incidents.openedAt))
        .limit(20)
    : [];
  const updates = recent.length
    ? await db
        .select({ incidentId: incidentUpdates.incidentId, status: incidentUpdates.status, message: incidentUpdates.message, createdAt: incidentUpdates.createdAt })
        .from(incidentUpdates)
        .where(and(eq(incidentUpdates.orgId, page.orgId), inArray(incidentUpdates.incidentId, recent.map((i) => i.id))))
        .orderBy(desc(incidentUpdates.createdAt))
    : [];

  const publicIncidents = recent.map((i) => ({
    // Titled with the public component name: the internal monitor name never leaks.
    title: `${nameByMonitor.get(i.monitorId) ?? "Service"} ${i.status === "resolved" ? "outage" : "is experiencing an outage"}`,
    status: i.status === "resolved" ? ("resolved" as const) : ("ongoing" as const),
    startedAt: i.openedAt,
    resolvedAt: i.resolvedAt,
    updates: updates.filter((u) => u.incidentId === i.id).map((u) => ({ status: u.status, message: u.message, at: u.createdAt })),
  }));

  return {
    title: page.title,
    description: page.description,
    overall: overallStatus(components.map((c) => c.status)),
    components,
    incidents: publicIncidents,
    generatedAt: now,
  };
}

export type PublicStatusPage = NonNullable<Awaited<ReturnType<typeof getPublicStatusPage>>>;
