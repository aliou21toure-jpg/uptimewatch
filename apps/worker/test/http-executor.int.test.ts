import { schema, type Database } from "@uptimewatch/db";
import { isBlockedAddress } from "@uptimewatch/monitoring";
import { eq } from "drizzle-orm";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { processCheckJob } from "../src/jobs/checks";
import { createHttpExecutor } from "../src/jobs/http-executor";
import { scheduleDueChecks } from "../src/jobs/scheduler";
import { connect, reset, seedMonitors } from "./helpers";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

let db: Database;
let close: () => Promise<void>;
let server: http.Server;
let port: number;
let healthy = true;

beforeAll(async () => {
  ({ db, close } = connect());
  server = http.createServer((_req, res) => (healthy ? res.end("ok") : res.writeHead(500).end()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.close();
  await close();
});
beforeEach(() => reset(db));

// Same production client; only DNS and the loopback exception are swapped for the local server.
const executor = createHttpExecutor({
  resolve: async () => [{ address: "127.0.0.1", family: 4 }],
  isBlocked: (ip) => ip !== "127.0.0.1" && isBlockedAddress(ip),
});

async function runOnce(monitorId: string) {
  await db.update(schema.monitors).set({ nextCheckAt: new Date(Date.now() - 1000) }).where(eq(schema.monitors.id, monitorId));
  await scheduleDueChecks(db);
  const [event] = await db.select().from(schema.outboxEvents);
  await db.delete(schema.outboxEvents);
  return processCheckJob(db, executor, event!.payload as never);
}

describe("HTTP executor in the worker", () => {
  it("checks a real HTTP endpoint and drives the monitor through an outage", async () => {
    const { monitors } = await seedMonitors(db, 1, new Date(), { url: `http://app.example.test:${port}/` });
    const id = monitors[0]!.id;
    const states: string[] = [];
    for (const isUp of [true, false, false, true, true]) {
      healthy = isUp;
      await runOnce(id);
      const [m] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, id));
      states.push(m!.state);
    }
    expect(states).toEqual(["healthy", "degraded", "down", "recovering", "healthy"]);
    const checks = await db.select().from(schema.monitorChecks);
    expect(checks.filter((c) => c.state === "down").every((c) => c.httpStatus === 500 && c.errorCode === "UNEXPECTED_STATUS")).toBe(true);
    expect(checks.filter((c) => c.state === "up").every((c) => c.latencyMs !== null)).toBe(true);
  });
});
