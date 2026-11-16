import { getEnv } from "@uptimewatch/config";
import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * Creates a Redis connection. BullMQ needs `maxRetriesPerRequest: null` on the connections it
 * blocks on, so callers create and own connections rather than sharing one.
 */
export function createRedis(options: { forQueue?: boolean; url?: string } = {}): Redis {
  const redis = new Redis(options.url ?? getEnv().REDIS_URL, {
    maxRetriesPerRequest: options.forQueue ? null : 2,
    lazyConnect: !options.forQueue,
  });
  // Without a listener ioredis prints every connection error as an unhandled event.
  // Failures still surface to callers through rejected commands.
  redis.on("error", () => {});
  return redis;
}

export async function pingRedis(redis: Redis): Promise<void> {
  if (redis.status === "wait") await redis.connect();
  const reply = await redis.ping();
  if (reply !== "PONG") throw new Error(`Unexpected Redis PING reply: ${reply}`);
}

// ------------------------------------------------------------------ checks queue

export const CHECKS_QUEUE = "checks";

export interface CheckJobData {
  checkId: string;
  orgId: string;
  monitorId: string;
  /** ISO timestamp; with checkId it addresses the row directly in its daily partition. */
  scheduledFor: string;
  /** Execution attempt this job was published for (0 = first). Part of the job id. */
  attempt: number;
}

/**
 * Deterministic job id: re-publishing the same outbox event (e.g. after a crash between
 * "sent to Redis" and "marked published") is a no-op in BullMQ instead of a duplicate job.
 * A retry after an abandoned lease gets a new attempt number, hence a new id.
 */
export const checkJobId = (checkId: string, attempt: number) => `check-${checkId}-${attempt}`;

export function createChecksQueue(connection: ConnectionOptions): Queue<CheckJobData> {
  return new Queue<CheckJobData>(CHECKS_QUEUE, {
    connection,
    defaultJobOptions: {
      // Retries cover infrastructure failures in the processor (database briefly unavailable...).
      // The check row's state machine guarantees a slot is still executed at most once.
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      // Completed ids are kept for an hour so late duplicate publications are still deduplicated.
      removeOnComplete: { age: 3600, count: 50_000 },
      removeOnFail: { age: 24 * 3600 },
    },
  });
}

// ------------------------------------------------------------------ notifications queue

export const NOTIFICATIONS_QUEUE = "notifications";

export interface IncidentNotificationJobData {
  incidentId: string;
  orgId: string;
  eventType: "incident.opened" | "incident.resolved";
}

export const notificationJobId = (data: IncidentNotificationJobData) =>
  `${data.eventType.replace(".", "-")}-${data.incidentId}`;

export function createNotificationsQueue(connection: ConnectionOptions): Queue<IncidentNotificationJobData> {
  return new Queue<IncidentNotificationJobData>(NOTIFICATIONS_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
}

export type { Queue, Redis };
