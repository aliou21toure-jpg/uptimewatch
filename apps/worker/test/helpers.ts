import { createDatabase, schema, type Database } from "@uptimewatch/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { inject } from "vitest";

export function connect(max = 10): { db: Database; close: () => Promise<void> } {
  const { db, pool } = createDatabase(inject("databaseUrl"), max);
  return { db, close: () => pool.end() };
}

export async function reset(db: Database) {
  await db.execute(sql`TRUNCATE outbox_events, monitor_checks, monitors, organization_members, organizations, "user" CASCADE`);
}

/** An organization with `count` enabled monitors due at `dueAt`. */
export async function seedMonitors(db: Database, count: number, dueAt: Date, overrides: Partial<typeof schema.monitors.$inferInsert> = {}) {
  const userId = randomUUID();
  await db.insert(schema.user).values({ id: userId, name: "Owner", email: `${userId}@example.test`, emailVerified: true });
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "Acme", slug: `acme-${userId.slice(0, 8)}`, createdBy: userId })
    .returning();
  const rows = await db
    .insert(schema.monitors)
    .values(
      Array.from({ length: count }, (_, i) => ({
        orgId: org!.id,
        name: `m${i}`,
        url: `https://s${i}.example.com`,
        nextCheckAt: dueAt,
        ...overrides,
      })),
    )
    .returning();
  return { orgId: org!.id, monitors: rows };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
