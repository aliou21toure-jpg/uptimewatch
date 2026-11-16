import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./index";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Applies pending SQL migrations. Only needs a database URL (not the full app environment),
 * so it can run as a one-off release step and inside test setup.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDatabase(connectionString, 1);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[db] DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log("[db] migrations applied"))
    .catch((error: unknown) => {
      console.error("[db] migration failed:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
