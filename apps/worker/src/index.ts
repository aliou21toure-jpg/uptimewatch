import { getEnv } from "@uptimewatch/config";
import { closeDb, getDb } from "@uptimewatch/db";
import { getEmailSender } from "@uptimewatch/email";
import {
  CHECKS_QUEUE,
  NOTIFICATIONS_QUEUE,
  checkJobId,
  createChecksQueue,
  createNotificationsQueue,
  createRedis,
  notificationJobId,
  pingRedis,
  type CheckJobData,
  type IncidentNotificationJobData,
} from "@uptimewatch/queue";
import { Worker } from "bullmq";
import { processCheckJob } from "./jobs/checks";
import { createHttpExecutor } from "./jobs/http-executor";
import { runMaintenance } from "./jobs/maintenance";
import { fanOutIncidentEvent, sendDueDeliveries } from "./jobs/notifications";
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
  const notificationConnection = createRedis({ forQueue: true });
  await pingRedis(queueConnection);

  const checksQueue = createChecksQueue(queueConnection);
  const notificationsQueue = createNotificationsQueue(queueConnection);
  const executor = createHttpExecutor();
  const email = getEmailSender();

  const publish = async (event: OutboxEvent) => {
    switch (event.eventType) {
      case "check.scheduled": {
        const data = event.payload as CheckJobData;
        await checksQueue.add("check", data, { jobId: checkJobId(data.checkId, data.attempt) });
        return;
      }
      case "incident.opened":
      case "incident.resolved": {
        const data = { ...(event.payload as Omit<IncidentNotificationJobData, "eventType">), eventType: event.eventType };
        await notificationsQueue.add(event.eventType, data, { jobId: notificationJobId(data) });
        return;
      }
      default:
        throw new Error(`No publisher for ${event.eventType}`);
    }
  };

  const checkWorker = new Worker<CheckJobData>(
    CHECKS_QUEUE,
    async (job) => processCheckJob(db, executor, job.data),
    { connection: workerConnection, concurrency: CONCURRENCY },
  );
  checkWorker.on("failed", (job, error) => {
    console.error(`[worker:checks] job ${job?.id ?? "?"} failed: ${error.name}`);
  });

  const notificationWorker = new Worker<IncidentNotificationJobData>(
    NOTIFICATIONS_QUEUE,
    async (job) => {
      await fanOutIncidentEvent(db, job.data);
      return sendDueDeliveries(db, email, { incidentId: job.data.incidentId });
    },
    { connection: notificationConnection, concurrency: 5 },
  );
  notificationWorker.on("failed", (job, error) => {
    console.error(`[worker:notifications] job ${job?.id ?? "?"} failed: ${error.name}`);
  });

  const loops = [
    every("maintenance", 60 * 60_000, () => runMaintenance(db)),
    every("scheduler", 2_000, () => scheduleDueChecks(db)),
    every("outbox", 500, () => dispatchOutbox(db, publish)),
    // Retries failed or interrupted email deliveries with exponential backoff.
    every("deliveries", 15_000, async () => {
      const r = await sendDueDeliveries(db, email);
      if (r.retrying || r.failed) console.warn("[worker:deliveries]", r);
    }),
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
    await Promise.all([checkWorker.close(), notificationWorker.close()]); // wait for in-flight jobs
    await Promise.all([checksQueue.close(), notificationsQueue.close()]);
    queueConnection.disconnect();
    workerConnection.disconnect();
    notificationConnection.disconnect();
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
