import { getEnv } from "@uptimewatch/config";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a query: the pool-backed database or an open transaction. */
export type Executor = Database | Transaction;

export function createDatabase(connectionString: string, max = 10): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, max });
  return { db: drizzle(pool, { schema }), pool };
}

let shared: { db: Database; pool: pg.Pool } | undefined;

/** Shared connection pool. PostgreSQL is the source of truth for all business data. */
export function getDb(): Database {
  shared ??= createDatabase(getEnv().DATABASE_URL);
  return shared.db;
}

export async function pingDatabase(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

export async function closeDb(): Promise<void> {
  await shared?.pool.end();
  shared = undefined;
}

export { schema };
