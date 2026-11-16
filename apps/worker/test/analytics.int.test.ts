import { schema, type Database } from "@uptimewatch/db";
import { DomainError, monitorStats, organizationDashboard } from "@uptimewatch/domain";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scheduleDueChecks } from "../src/jobs/scheduler";
import { refreshDailyStats } from "../src/jobs/stats";
import { connect, reset, seedMonitors } from "./helpers";

let db: Database;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());
beforeEach(() => reset(db));

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

type Row = { state: "up" | "down" | "error" | "skipped"; latency?: number; minutesAgo: number; missed?: number };

async function insertChecks(orgId: string, monitorId: string, rows: Row[]) {
  await db.insert(schema.monitorChecks).values(
    rows.map((r) => ({
      orgId,
      monitorId,
      scheduledFor: minutesAgo(r.minutesAgo),
      state: r.state,
      latencyMs: r.latency ?? null,
      httpStatus: r.state === "up" ? 200 : r.state === "down" ? 500 : null,
      missedSlots: r.missed ?? 0,
    })),
  );
}

describe("daily aggregation", () => {
  it("computes uptime without platform errors, coverage with them, and exact percentiles", async () => {
    const { orgId, monitors } = await seedMonitors(db, 1, new Date());
    const id = monitors[0]!.id;
    // 1..100 ms successes, 10 failures, 5 platform errors, 3 skipped, 2 missed slots — all within the last hour.
    await insertChecks(orgId, id, [
      ...Array.from({ length: 100 }, (_, i): Row => ({ state: "up", latency: i + 1, minutesAgo: 1 + (i % 50) })),
      ...Array.from({ length: 10 }, (): Row => ({ state: "down", latency: 9999, minutesAgo: 1 })),
      ...Array.from({ length: 5 }, (): Row => ({ state: "error", minutesAgo: 2 })),
      ...Array.from({ length: 3 }, (): Row => ({ state: "skipped", minutesAgo: 3 })),
      { state: "up", latency: 50, minutesAgo: 4, missed: 2 } as Row,
    ].map((r, i) => ({ ...r, minutesAgo: r.minutesAgo + i / 1000 })));

    await refreshDailyStats(db, minutesAgo(60), now);
    const days = await db.select().from(schema.monitorDailyStats);
    const totals = days.reduce(
      (t, d) => ({ up: t.up + d.successfulChecks, down: t.down + d.failedChecks, err: t.err + d.platformErrorChecks, skip: t.skip + d.skippedChecks, missed: t.missed + d.missedSlots }),
      { up: 0, down: 0, err: 0, skip: 0, missed: 0 },
    );
    expect(totals).toEqual({ up: 101, down: 10, err: 5, skip: 3, missed: 2 });

    const stats = await monitorStats(db, { userId: (await owner(orgId)) }, orgId, id, now);
    const w = stats.windows["24h"];
    expect(w.checks).toBe(111);
    expect(w.uptime).toBeCloseTo((100 * 101) / 111, 5); // errors and skipped excluded
    expect(w.coverage).toBeCloseTo((100 * 111) / (111 + 5 + 3 + 2), 5);
    expect(w.p50LatencyMs).toBe(50); // successes only: failures' 9999 ms are ignored
    expect(w.p95LatencyMs).toBe(95);
    expect(w.avgLatencyMs).toBe(50);

    // 7/30-day windows from the aggregates agree with the raw counts.
    expect(stats.windows["30d"].checks).toBe(111);
    expect(stats.windows["30d"].uptime).toBeCloseTo((100 * 101) / 111, 3);
    expect(stats.daily).toHaveLength(30);
    expect(stats.hourly.reduce((s, h) => s + h.up + h.down, 0)).toBe(111);
  });

  it("is idempotent", async () => {
    const { orgId, monitors } = await seedMonitors(db, 1, new Date());
    await insertChecks(orgId, monitors[0]!.id, [{ state: "up", latency: 10, minutesAgo: 5 }]);
    await refreshDailyStats(db, minutesAgo(10), now);
    await refreshDailyStats(db, minutesAgo(10), now);
    const [row] = await db.select().from(schema.monitorDailyStats);
    expect(row).toMatchObject({ totalChecks: 1, successfulChecks: 1 });
  });

  it("keeps 7/30-day windows consistent with the live 24 h window between aggregation runs", async () => {
    const { orgId, ownerId, monitors } = await seedMonitors(db, 1, new Date());
    const id = monitors[0]!.id;
    const yesterdayNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12));
    await db.insert(schema.monitorChecks).values([
      { orgId, monitorId: id, scheduledFor: yesterdayNoon, state: "down" },
      { orgId, monitorId: id, scheduledFor: new Date(yesterdayNoon.getTime() + 60_000), state: "up", latencyMs: 30 },
    ]);
    await refreshDailyStats(db, yesterdayNoon, yesterdayNoon);
    // Today's checks exist only as raw rows: the aggregation job has not run yet.
    await insertChecks(orgId, id, [{ state: "up", latency: 10, minutesAgo: 0.5 }, { state: "up", latency: 20, minutesAgo: 0.6 }]);

    const s = await monitorStats(db, { userId: ownerId }, orgId, id, now);
    expect(s.windows["30d"]).toMatchObject({ checks: 4, failedChecks: 1, avgLatencyMs: 20 });
    expect(s.windows["30d"].uptime).toBeCloseTo(75, 5);
    expect(s.daily.at(-1)).toMatchObject({ checks: 2, uptime: 100 });
    expect(s.daily.at(-2)).toMatchObject({ checks: 2, failed: 1 });
  });

  it("records the slots missed while the scheduler was down", async () => {
    const { monitors } = await seedMonitors(db, 1, minutesAgo(10)); // 60 s interval, 10 min late
    await scheduleDueChecks(db, { now });
    const [check] = await db.select().from(schema.monitorChecks).where(eq(schema.monitorChecks.monitorId, monitors[0]!.id));
    expect(check!.missedSlots).toBe(10);
  });
});

async function owner(orgId: string) {
  const [m] = await db.select().from(schema.organizationMembers).where(eq(schema.organizationMembers.orgId, orgId));
  return m!.userId;
}

describe("dashboard", () => {
  it("accounts for downtime inside each window, including ongoing incidents", async () => {
    const { orgId, monitors } = await seedMonitors(db, 2, new Date());
    const [a, b] = monitors;
    await db.insert(schema.incidents).values([
      // resolved, 30 min long, 2 h ago
      { orgId, monitorId: a!.id, title: "a", status: "resolved", openedAt: minutesAgo(150), detectedAt: minutesAgo(149), resolvedAt: minutesAgo(120) },
      // ongoing for 10 min
      { orgId, monitorId: b!.id, title: "b", status: "open", openedAt: minutesAgo(10), detectedAt: minutesAgo(9) },
      // 3 days ago: outside 24 h, inside 7 d
      { orgId, monitorId: a!.id, title: "old", status: "resolved", openedAt: minutesAgo(3 * 1440 + 60), detectedAt: minutesAgo(3 * 1440 + 59), resolvedAt: minutesAgo(3 * 1440) },
    ]);
    await db.update(schema.monitors).set({ state: "down" }).where(eq(schema.monitors.id, b!.id));

    const d = await organizationDashboard(db, { userId: await owner(orgId) }, orgId, now);
    expect(d.windows["24h"].incidents).toBe(2);
    expect(d.windows["24h"].downtimeSeconds).toBe(40 * 60);
    expect(d.windows["7d"].incidents).toBe(3);
    expect(d.windows["7d"].downtimeSeconds).toBe(100 * 60);
    expect(d.counts).toMatchObject({ total: 2, down: 1, openIncidents: 1 });
    expect(d.monitors[0]!.id).toBe(b!.id); // down monitors first
    expect(d.events[0]).toMatchObject({ type: "opened", monitorName: b!.name });
  });

  it("only ever shows the caller's organization", async () => {
    const a = await seedMonitors(db, 1, new Date());
    const b = await seedMonitors(db, 1, new Date());
    await insertChecks(a.orgId, a.monitors[0]!.id, [{ state: "down", minutesAgo: 1 }]);
    await refreshDailyStats(db, minutesAgo(10), now);

    const dB = await organizationDashboard(db, { userId: b.ownerId }, b.orgId, now);
    expect(dB.windows["24h"].checks).toBe(0);
    expect(dB.monitors.map((m) => m.id)).toEqual([b.monitors[0]!.id]);
    await expect(organizationDashboard(db, { userId: b.ownerId }, a.orgId, now)).rejects.toBeInstanceOf(DomainError);
    await expect(monitorStats(db, { userId: b.ownerId }, b.orgId, a.monitors[0]!.id, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A random user id is not a member of anything.
    await expect(organizationDashboard(db, { userId: randomUUID() }, a.orgId, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
