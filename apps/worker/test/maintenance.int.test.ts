import type { Database } from "@uptimewatch/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECK_RETENTION_DAYS, runMaintenance } from "../src/jobs/maintenance";
import { connect } from "./helpers";

let db: Database;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());

const partitions = async () =>
  (
    await db.execute<{ name: string }>(sql`
      SELECT c.relname AS name FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'monitor_checks'::regclass ORDER BY 1`)
  ).rows.map((r) => r.name);

describe("maintenance", () => {
  it("creates partitions ahead and drops those past retention", async () => {
    const old = new Date(Date.now() - (CHECK_RETENTION_DAYS + 5) * 86_400_000);
    await runMaintenance(db, old); // creates partitions around an old date
    const day = (d: Date) => `monitor_checks_p${d.toISOString().slice(0, 10).replaceAll("-", "")}`;
    expect(await partitions()).toContain(day(old));

    const result = await runMaintenance(db);
    expect(result!.partitionsDropped).toBeGreaterThan(0);
    const after = await partitions();
    expect(after).not.toContain(day(old));
    expect(after).toContain(day(new Date(Date.now() + 7 * 86_400_000)));
  });

  it("is a no-op while another worker holds the lock", async () => {
    // Hold the maintenance lock from another session, as a concurrent worker would.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('uptimewatch:maintenance', 0))`);
      expect(await runMaintenance(db)).toBeNull();
    });
    expect(await runMaintenance(db)).not.toBeNull();
  });
});
