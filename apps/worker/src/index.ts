import { getEnv } from "@uptimewatch/config";
import { closeDb, pingDatabase } from "@uptimewatch/db";
import { createRedis, pingRedis } from "@uptimewatch/queue";

/**
 * Worker process entry point. It runs independently of the web app and can be restarted or
 * scaled horizontally. The scheduler, outbox dispatcher and check processors are added in
 * Phase 3; for now it validates configuration and connectivity and shuts down cleanly.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const redis = createRedis();

  await pingDatabase();
  await pingRedis(redis);
  console.log(`[worker] ready (env=${env.NODE_ENV}) — postgres ok, redis ok`);

  const keepAlive = setInterval(() => {}, 60_000);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} received, shutting down`);
    clearInterval(keepAlive);
    redis.disconnect();
    await closeDb();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("[worker] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
