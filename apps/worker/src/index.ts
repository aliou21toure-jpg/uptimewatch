import { getEnv } from "@uptimewatch/config";
import { closeDb, getDb } from "@uptimewatch/db";
import { CHECKS_QUEUE, checkJobId, createChecksQueue, createRedis, pingRedis, type CheckJobData } from "@uptimewatch/queue";
import { Worker } from "bullmq";
import { processCheckJob } from "./jobs/checks";
import { createHttpExecutor } from "./jobs/http-executor";
import { runMaintenance } from "./jobs/maintenance";
import { dispatchOutbox, type OutboxEvent } from "./jobs/outbox";
import { recoverAbandonedChecks } from "./jobs/recovery";
import { scheduleDueChecks } from "./jobs/scheduler";
import { every } from "./loop";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 20);


/**
 * One worker process runs every background role. Each role is safe to run in several processes at
 * once (SKIP LOCKED, unique slots, advisory locks), so the worker scales by adding replicas.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const db = getDb();
  const queueConnection = createRedis({ forQueue: true });
  const workerConnection = createRedis({ forQueue: true });
  await pingRedis(queueConnection);

  const checksQueue = createChecksQueue(queueConnection);
  const executor = createHttpExecutor();

  const publish = async (event: OutboxEvent) => {
    if (event.eventType !== "check.scheduled") throw new Error(`No publisher for ${event.eventType}`);
    const data = event.payload as CheckJobData;
    await checksQueue.add("check", data, { jobId: checkJobId(data.checkId, data.attempt) });
  };

  const checkWorker = new Worker<CheckJobData>(
    CHECKS_QUEUE,
    async (job) => processCheckJob(db, executor, job.data),
    { connection: workerConnection, concurrency: CONCURRENCY },
  );
  checkWorker.on("failed", (job, error) => {
    console.error(`[worker:checks] job ${job?.id ?? "?"} failed: ${error.name}`);
  });

  const loops = [
    every("maintenance", 60 * 60_000, () => runMaintenance(db)),
    every("scheduler", 2_000, () => scheduleDueChecks(db)),
    every("outbox", 500, () => dispatchOutbox(db, publish)),
    every("recovery", 30_000, async () => {
      const r = await recoverAbandonedChecks(db);
      if (r.requeued || r.failed || r.stale) console.warn("[worker:recovery]", r);
    }),
  ];

  console.log(`[worker] ready (env=${env.NODE_ENV}, concurrency=${CONCURRENCY})`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received, draining`);
    await Promise.all(loops.map((l) => l.stop()));
    await checkWorker.close(); // waits for in-flight checks
    await checksQueue.close();
    queueConnection.disconnect();
    workerConnection.disconnect();
    await closeDb();
    console.log("[worker] stopped");
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("[worker] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
