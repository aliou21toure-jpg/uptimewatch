import { getEnv } from "@uptimewatch/config";
import { Redis } from "ioredis";

/**
 * Creates a Redis connection. BullMQ (added in Phase 3) needs its own connections with
 * `maxRetriesPerRequest: null`, so callers create and own connections rather than sharing one.
 */
export function createRedis(options: { forQueue?: boolean } = {}): Redis {
  const redis = new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: options.forQueue ? null : 2,
    lazyConnect: true,
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

export type { Redis };
