import type { TestProject } from "vitest/node";

/**
 * Provides a migrated PostgreSQL database for integration tests.
 * - TEST_DATABASE_URL set: use that database (fast local loop; it is reset by migrations + truncation).
 * - Otherwise: start a disposable PostgreSQL 17 container with Testcontainers (CI default).
 */
export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<unknown>) | undefined;

  if (!url) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const container = await new PostgreSqlContainer("postgres:17-alpine").start();
    url = container.getConnectionUri();
    stop = () => container.stop();
  }

  const { runMigrations } = await import("@uptimewatch/db/migrate");
  await runMigrations(url);

  project.provide("databaseUrl", url);
  return async () => {
    await stop?.();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
