import type { TestProject } from "vitest/node";

/**
 * Real PostgreSQL and Redis for the worker tests.
 * TEST_DATABASE_URL / TEST_REDIS_URL reuse local services; otherwise Testcontainers starts them.
 */
export default async function setup(project: TestProject) {
  const stops: (() => Promise<unknown>)[] = [];

  let databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const pg = await new PostgreSqlContainer("postgres:17-alpine").start();
    databaseUrl = pg.getConnectionUri();
    stops.push(() => pg.stop());
  }
  let redisUrl = process.env.TEST_REDIS_URL;
  if (!redisUrl) {
    const { RedisContainer } = await import("@testcontainers/redis");
    const redis = await new RedisContainer("redis:7-alpine").start();
    redisUrl = redis.getConnectionUrl();
    stops.push(() => redis.stop());
  }

  const { runMigrations } = await import("@uptimewatch/db/migrate");
  await runMigrations(databaseUrl);

  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", redisUrl);
  return async () => {
    await Promise.all(stops.map((stop) => stop()));
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}
