import { createDatabase, schema, type Database } from "@uptimewatch/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { inject } from "vitest";

export function connect(): { db: Database; close: () => Promise<void> } {
  const { db, pool } = createDatabase(inject("databaseUrl"), 5);
  return { db, close: () => pool.end() };
}

export async function resetDatabase(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE notification_deliveries, notification_preferences, incident_updates, incidents, outbox_events, monitor_checks, monitors, organization_invitations, organization_members, organizations, session, account, verification, "user" CASCADE`,
  );
}

export async function createUser(
  db: Database,
  overrides: Partial<{ email: string; name: string; emailVerified: boolean }> = {},
) {
  const id = randomUUID();
  const [row] = await db
    .insert(schema.user)
    .values({
      id,
      name: overrides.name ?? `User ${id.slice(0, 4)}`,
      email: overrides.email ?? `${id}@example.test`,
      emailVerified: overrides.emailVerified ?? true,
    })
    .returning();
  return { userId: row!.id, email: row!.email, emailVerified: row!.emailVerified };
}
