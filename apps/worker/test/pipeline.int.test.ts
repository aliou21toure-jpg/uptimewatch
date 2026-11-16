import { schema, type Database } from "@uptimewatch/db";
import { CHECKS_QUEUE, checkJobId, createChecksQueue, createRedis, type CheckJobData } from "@uptimewatch/queue";
import { Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { LEASE_MS, completeCheck, processCheckJob, reserveCheck, type CheckExecutor } from "../src/jobs/checks";
import { dispatchOutbox, type OutboxEvent } from "../src/jobs/outbox";
import { MAX_CHECK_ATTEMPTS, STALE_AFTER_MS, recoverAbandonedChecks } from "../src/jobs/recovery";
import { scheduleDueChecks } from "../src/jobs/scheduler";
import { connect, reset, seedMonitors, sleep } from "./helpers";

let db: Database;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect(20)));
afterAll(() => close());
beforeEach(() => reset(db));

const upExecutor: CheckExecutor = async () => ({ state: "up", httpStatus: 200, latencyMs: 42 });

async function scheduledJob(now = new Date()): Promise<CheckJobData> {
  await scheduleDueChecks(db, { now });
  const [event] = await db.select().from(schema.outboxEvents);
  return event!.payload as CheckJobData;
}

describe("check processing", () => {
  it("records the outcome and updates the monitor", async () => {
    const { monitors } = await seedMonitors(db, 1, new Date(Date.now() - 1000));
    const job = await scheduledJob();
    expect(await processCheckJob(db, upExecutor, job)).toBe("completed");

    const [check] = await db.select().from(schema.monitorChecks);
    expect(check).toMatchObject({ state: "up", httpStatus: 200, latencyMs: 42, attempts: 1, leaseUntil: null });
    const [m] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, monitors[0]!.id));
    expect(m!.lastCheckedAt).not.toBeNull();
    expect(m!.lastSuccessAt).not.toBeNull();
  });

  it("executes a slot once even when the job is delivered several times concurrently", async () => {
    await seedMonitors(db, 1, new Date(Date.now() - 1000));
    const job = await scheduledJob();
    let calls = 0;
    const slow: CheckExecutor = async () => {
      calls++;
      await sleep(50);
      return { state: "up" };
    };
    const results = await Promise.all(Array.from({ length: 10 }, () => processCheckJob(db, slow, job)));
    expect(calls).toBe(1);
    expect(results.filter((r) => r === "completed")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate")).toHaveLength(9);
  });

  it("treats an executor crash as a platform error, not a site failure", async () => {
    await seedMonitors(db, 1, new Date(Date.now() - 1000));
    const job = await scheduledJob();
    await processCheckJob(db, async () => { throw new TypeError("boom"); }, job);
    const [check] = await db.select().from(schema.monitorChecks);
    expect(check).toMatchObject({ state: "error", errorCode: "ENGINE_ERROR" });
  });

  it("skips a check whose monitor was paused after scheduling", async () => {
    const { monitors } = await seedMonitors(db, 1, new Date(Date.now() - 1000));
    const job = await scheduledJob();
    await db.update(schema.monitors).set({ enabled: false, state: "paused", nextCheckAt: null }).where(eq(schema.monitors.id, monitors[0]!.id));
    await processCheckJob(db, upExecutor, job);
    const [check] = await db.select().from(schema.monitorChecks);
    expect(check).toMatchObject({ state: "skipped", errorCode: "MONITOR_PAUSED" });
  });
});

describe("leases and recovery", () => {
  it("re-queues a check whose worker died, and a zombie worker cannot overwrite the retry", async () => {
    await seedMonitors(db, 1, new Date(Date.now() - 1000));
    const job = await scheduledJob();
    const t0 = new Date();

    const zombie = await reserveCheck(db, job, t0); // worker A reserves, then hangs
    expect(zombie?.attempt).toBe(1);

    const afterLease = new Date(t0.getTime() + LEASE_MS + 1000);
    expect(await recoverAbandonedChecks(db, afterLease)).toMatchObject({ requeued: 1 });
    const retryEvent = (await db.select().from(schema.outboxEvents)).find((e) => e.dedupeKey.startsWith("check.requeued"));
    expect(retryEvent!.payload).toMatchObject({ attempt: 1 });

    // Worker B runs the retry.
    expect(await processCheckJob(db, upExecutor, retryEvent!.payload as CheckJobData, { now: () => afterLease })).toBe("completed");
    // Worker A wakes up and tries to record a stale result: refused (fencing on the attempt number).
    expect((await completeCheck(db, zombie!, { state: "down", errorCode: "TIMEOUT" })).recorded).toBe(false);
    const [check] = await db.select().from(schema.monitorChecks);
    expect(check).toMatchObject({ state: "up", attempts: 2 });
  });

  it(`gives up after ${MAX_CHECK_ATTEMPTS} attempts with a platform error`, async () => {
    await seedMonitors(db, 1, new Date(Date.now() - 1000));
    const job = await scheduledJob();
    let t = new Date();
    for (let i = 0; i < MAX_CHECK_ATTEMPTS; i++) {
      expect(await reserveCheck(db, { ...job, attempt: i }, t)).not.toBeNull();
      t = new Date(t.getTime() + LEASE_MS + 1000);
      await recoverAbandonedChecks(db, t);
    }
    const [check] = await db.select().from(schema.monitorChecks);
    expect(check).toMatchObject({ state: "error", errorCode: "LEASE_EXPIRED", attempts: MAX_CHECK_ATTEMPTS });
  });

  it("re-publishes queued checks that were never picked up, and skips stale ones", async () => {
    await seedMonitors(db, 1, new Date(Date.now() - 1000));
    await scheduledJob();
    const in3min = new Date(Date.now() + 3 * 60_000);
    expect(await recoverAbandonedChecks(db, in3min)).toMatchObject({ requeued: 1, stale: 0 });
    expect(await recoverAbandonedChecks(db, in3min)).toMatchObject({ requeued: 0 }); // just re-queued

    const muchLater = new Date(Date.now() + STALE_AFTER_MS + 60_000);
    expect(await recoverAbandonedChecks(db, muchLater)).toMatchObject({ stale: 1, requeued: 0 });
    const [check] = await db.select().from(schema.monitorChecks);
    expect(check).toMatchObject({ state: "skipped", errorCode: "STALE" });
  });
});

describe("outbox to BullMQ", () => {
  let connection: ReturnType<typeof createRedis>;
  let queue: ReturnType<typeof createChecksQueue>;

  beforeAll(async () => {
    connection = createRedis({ forQueue: true, url: inject("redisUrl") });
    queue = createChecksQueue(connection);
  });
  beforeEach(() => queue.obliterate({ force: true }));
  afterAll(async () => {
    await queue.close();
    connection.disconnect();
  });

  const publisher = (q = queue) => async (event: OutboxEvent) => {
    const data = event.payload as CheckJobData;
    await q.add("check", data, { jobId: checkJobId(data.checkId, data.attempt) });
  };

  it("publishes each event once and marks it", async () => {
    await seedMonitors(db, 5, new Date(Date.now() - 1000));
    await scheduleDueChecks(db);
    expect(await dispatchOutbox(db, publisher())).toEqual({ published: 5, failed: 0 });
    expect(await dispatchOutbox(db, publisher())).toEqual({ published: 0, failed: 0 });
    expect(await queue.getJobCountByTypes("waiting")).toBe(5);
  });

  it("does not create a duplicate job when it crashes after publishing but before committing", async () => {
    await seedMonitors(db, 1, new Date(Date.now() - 1000));
    await scheduleDueChecks(db);
    const publish = publisher();
    // First dispatcher publishes to Redis, then "crashes": its transaction rolls back.
    await expect(
      dispatchOutbox(db, async (e) => {
        await publish(e);
        throw Object.assign(new Error("simulated crash"), { crash: true });
      }).then(() => db.execute(sql`SELECT 1/0`)),
    ).rejects.toThrow();
    // The failure path recorded a retry; force it due again and re-dispatch.
    await db.update(schema.outboxEvents).set({ availableAt: new Date(0), publishedAt: null });
    expect((await dispatchOutbox(db, publish)).published).toBe(1);
    expect(await queue.getJobCountByTypes("waiting")).toBe(1);
  });

  it("backs off when Redis rejects the event", async () => {
    await seedMonitors(db, 1, new Date(Date.now() - 1000));
    await scheduleDueChecks(db);
    const now = new Date();
    expect(await dispatchOutbox(db, async () => { throw new Error("redis down"); }, { now })).toEqual({ published: 0, failed: 1 });
    const [event] = await db.select().from(schema.outboxEvents);
    expect(event).toMatchObject({ attempts: 1, lastError: "redis down", publishedAt: null });
    expect(event!.availableAt.getTime()).toBe(now.getTime() + 2000);
  });

  it("runs the whole pipeline: schedule → outbox → BullMQ → worker → result", async () => {
    await seedMonitors(db, 20, new Date(Date.now() - 1000));
    const workerConnection = createRedis({ forQueue: true, url: inject("redisUrl") });
    const worker = new Worker<CheckJobData>(CHECKS_QUEUE, (job) => processCheckJob(db, upExecutor, job.data), {
      connection: workerConnection,
      concurrency: 5,
    });
    try {
      await scheduleDueChecks(db);
      await dispatchOutbox(db, publisher());
      const deadline = Date.now() + 15_000;
      let done = 0;
      while (Date.now() < deadline) {
        const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM monitor_checks WHERE state = 'up'`);
        done = rows[0]!.n;
        if (done === 20) break;
        await sleep(100);
      }
      expect(done).toBe(20);
    } finally {
      await worker.close();
      workerConnection.disconnect();
    }
  });
});
