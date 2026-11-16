import { schema, type Database } from "@uptimewatch/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completeCheck, reserveCheck, type CheckOutcome } from "../src/jobs/checks";
import { scheduleDueChecks } from "../src/jobs/scheduler";
import { connect, reset, seedMonitors } from "./helpers";

let db: Database;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());
beforeEach(() => reset(db));

const base = Math.floor(Date.now() / 60_000) * 60_000;
const at = (minute: number) => new Date(base + minute * 60_000);

/** Schedules the slot at `minute`, reserves it and returns the reservation. */
async function slot(monitorId: string, minute: number) {
  await db.update(schema.monitors).set({ nextCheckAt: at(minute) }).where(eq(schema.monitors.id, monitorId));
  await scheduleDueChecks(db, { now: at(minute) });
  const [check] = await db.select().from(schema.monitorChecks).where(eq(schema.monitorChecks.scheduledFor, at(minute)));
  const data = { checkId: check!.id, orgId: check!.orgId, monitorId, scheduledFor: at(minute).toISOString(), attempt: 0 };
  return (await reserveCheck(db, data, at(minute)))!;
}

const up: CheckOutcome = { state: "up", httpStatus: 200, latencyMs: 10 };
const down: CheckOutcome = { state: "down", errorCode: "TIMEOUT" };

async function monitor(id: string) {
  const [m] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, id));
  return m!;
}

describe("monitor state from check results", () => {
  it("degrades, goes down, recovers and reports the incident transitions", async () => {
    const { monitors } = await seedMonitors(db, 1, at(0));
    const id = monitors[0]!.id;
    const transitions: (string | null)[] = [];
    for (const [i, outcome] of [up, down, down, up, up].entries()) {
      transitions.push((await completeCheck(db, await slot(id, i), outcome, at(i))).transition);
      transitions.push((await monitor(id)).state);
    }
    expect(transitions).toEqual([
      null, "healthy",
      null, "degraded",
      "incident_opened", "down",
      null, "recovering",
      "incident_resolved", "healthy",
    ]);
  });

  it("ignores a result that arrives after a newer slot was applied", async () => {
    const { monitors } = await seedMonitors(db, 1, at(0));
    const id = monitors[0]!.id;
    const older = await slot(id, 0);
    const newer = await slot(id, 1);
    await completeCheck(db, newer, up, at(1));
    const late = await completeCheck(db, older, down, at(2));
    expect(late).toEqual({ recorded: true, transition: null });
    expect(await monitor(id)).toMatchObject({ state: "healthy", consecutiveFailures: 0 });
  });

  it("does not let platform errors or skipped checks move the state", async () => {
    const { monitors } = await seedMonitors(db, 1, at(0));
    const id = monitors[0]!.id;
    await completeCheck(db, await slot(id, 0), down, at(0));
    await completeCheck(db, await slot(id, 1), { state: "error", errorCode: "ENGINE_ERROR" }, at(1));
    await completeCheck(db, await slot(id, 2), { state: "skipped", errorCode: "STALE" }, at(2));
    expect(await monitor(id)).toMatchObject({ state: "degraded", consecutiveFailures: 1 });
  });

  it("does not touch a monitor paused while its check was running", async () => {
    const { monitors } = await seedMonitors(db, 1, at(0));
    const id = monitors[0]!.id;
    const r = await slot(id, 0);
    await db.update(schema.monitors).set({ enabled: false, state: "paused", nextCheckAt: null }).where(eq(schema.monitors.id, id));
    await completeCheck(db, r, down, at(0));
    expect(await monitor(id)).toMatchObject({ state: "paused", consecutiveFailures: 0 });
  });
});
