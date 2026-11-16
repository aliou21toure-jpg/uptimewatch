import { getEnv } from "@uptimewatch/config";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Database | undefined;

/** Shared connection pool. PostgreSQL is the source of truth for all business data. */
export function getDb(): Database {
  if (!db) {
    pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL, max: 10 });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function pingDatabase(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

export { schema };
