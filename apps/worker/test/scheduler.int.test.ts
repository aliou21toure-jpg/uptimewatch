import { schema, type Database } from "@uptimewatch/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scheduleDueChecks } from "../src/jobs/scheduler";
import { connect, reset, seedMonitors } from "./helpers";

let db: Database;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect(20)));
afterAll(() => close());
beforeEach(() => reset(db));

// Real "now" (minute-aligned): the migration only creates partitions around the current date.
const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const seconds = (n: number) => new Date(now.getTime() + n * 1000);

describe("scheduler", () => {
  it("plans one check and one outbox event per due monitor, and advances next_check_at", async () => {
    const { monitors } = await seedMonitors(db, 3, seconds(-5));
    await seedMonitors(db, 2, seconds(+30)); // not due yet

    expect(await scheduleDueChecks(db, { now })).toEqual({ scheduled: 3 });

    const checks = await db.select().from(schema.monitorChecks);
    expect(checks).toHaveLength(3);
    expect(checks.every((c) => c.state === "queued" && c.scheduledFor.getTime() === seconds(-5).getTime())).toBe(true);

    const events = await db.select().from(schema.outboxEvents);
    expect(events).toHaveLength(3);
    expect(events[0]!.payload).toMatchObject({ attempt: 0, scheduledFor: seconds(-5).toISOString() });

    const [m] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, monitors[0]!.id));
    expect(m!.nextCheckAt!.getTime()).toBe(seconds(55).getTime());
    expect(await scheduleDueChecks(db, { now })).toEqual({ scheduled: 0 });
  });

  it("does not replay missed slots in a burst after downtime", async () => {
    const { monitors } = await seedMonitors(db, 1, seconds(-3600)); // scheduler was down for an hour
    await scheduleDueChecks(db, { now });
    const checks = await db.select().from(schema.monitorChecks);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.scheduledFor.getTime()).toBe(now.getTime());
    const [m] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, monitors[0]!.id));
    expect(m!.nextCheckAt!.getTime()).toBe(seconds(60).getTime());
  });

  it("keeps the cadence when it runs slightly late", async () => {
    await seedMonitors(db, 1, seconds(-20)); // 20 s late, within one interval
    await scheduleDueChecks(db, { now });
    await scheduleDueChecks(db, { now: seconds(41) });
    const slots = (await db.select().from(schema.monitorChecks).orderBy(asc(schema.monitorChecks.scheduledFor))).map(
      (c) => c.scheduledFor.toISOString(),
    );
    expect(slots).toEqual([seconds(-20).toISOString(), seconds(40).toISOString()]);
  });

  it("ignores paused monitors", async () => {
    await seedMonitors(db, 2, seconds(-5), { enabled: false, state: "paused" });
    expect(await scheduleDueChecks(db, { now })).toEqual({ scheduled: 0 });
  });

  it("never plans the same slot twice when schedulers run concurrently", async () => {
    await seedMonitors(db, 300, seconds(-1));
    // 8 schedulers race on the same instant with small batches.
    const results = await Promise.all(Array.from({ length: 8 }, () => scheduleDueChecks(db, { now, batchSize: 50 })));
    const total = results.reduce((s, r) => s + r.scheduled, 0);
    // Some runs may find nothing left; the remainder is picked up by the next tick.
    await scheduleDueChecks(db, { now, batchSize: 500 });

    const [{ checks, slots, events }] = (
      await db.execute<{ checks: number; slots: number; events: number }>(sql`
        SELECT (SELECT count(*) FROM monitor_checks)::int AS checks,
               (SELECT count(DISTINCT (monitor_id, scheduled_for)) FROM monitor_checks)::int AS slots,
               (SELECT count(*) FROM outbox_events)::int AS events`)
    ).rows as [{ checks: number; slots: number; events: number }];
    expect(total).toBeLessThanOrEqual(300);
    expect(checks).toBe(300);
    expect(slots).toBe(300);
    expect(events).toBe(300);
  });

  it("writes checks into the daily partition of their slot", async () => {
    await seedMonitors(db, 1, seconds(-5));
    await scheduleDueChecks(db, { now });
    const { rows } = await db.execute<{ partition: string }>(
      sql`SELECT tableoid::regclass::text AS partition FROM monitor_checks`,
    );
    const day = seconds(-5).toISOString().slice(0, 10).replaceAll("-", "");
    expect(rows[0]!.partition).toBe(`monitor_checks_p${day}`);
  });
});
