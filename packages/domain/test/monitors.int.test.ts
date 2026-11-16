import { schema, type Database } from "@uptimewatch/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_MONITORS_PER_ORGANIZATION,
  acceptInvitation,
  createInvitation,
  createMonitor,
  createOrganization,
  decryptMonitorHeaders,
  deleteMonitor,
  getMonitor,
  listMonitors,
  monitorSummary,
  pauseMonitor,
  resumeMonitor,
  updateMonitor,
  type DomainErrorCode,
} from "../src/index";
import { connect, createUser, resetDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());
beforeEach(() => resetDatabase(db));

const rejectsWith = (p: Promise<unknown>, code: DomainErrorCode) =>
  expect(p).rejects.toMatchObject({ name: "DomainError", code });

const site = { name: "Website", url: "https://example.com" };

async function setup() {
  const owner = await createUser(db);
  const org = await createOrganization(db, owner, { name: "Acme" });
  return { owner, org };
}

async function addMember(ownerActor: { userId: string }, orgId: string, role: "member" | "viewer") {
  const u = await createUser(db);
  const { token } = await createInvitation(db, ownerActor, orgId, { email: u.email, role });
  await acceptInvitation(db, u, { token });
  return u;
}

describe("monitor lifecycle", () => {
  it("creates with defaults and schedules the first check immediately", async () => {
    const { owner, org } = await setup();
    const before = Date.now();
    const m = await createMonitor(db, owner, org.id, site);
    expect(m).toMatchObject({ method: "GET", intervalSeconds: 60, timeoutMs: 10000, state: "unknown", enabled: true });
    expect(m.nextCheckAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("pauses and resumes, resetting state and counters", async () => {
    const { owner, org } = await setup();
    const m = await createMonitor(db, owner, org.id, site);
    await db.update(schema.monitors).set({ state: "degraded", consecutiveFailures: 1 }).where(eq(schema.monitors.id, m.id));

    const paused = await pauseMonitor(db, owner, org.id, m.id);
    expect(paused).toMatchObject({ enabled: false, state: "paused", nextCheckAt: null });
    expect(await pauseMonitor(db, owner, org.id, m.id)).toMatchObject({ state: "paused" }); // idempotent

    const resumed = await resumeMonitor(db, owner, org.id, m.id);
    expect(resumed).toMatchObject({ enabled: true, state: "unknown" });
    expect(resumed.nextCheckAt).not.toBeNull();
    const [row] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, m.id));
    expect(row!.consecutiveFailures).toBe(0);
  });

  it("updates fields, re-validates the merged result, and resets state when the URL changes", async () => {
    const { owner, org } = await setup();
    const m = await createMonitor(db, owner, org.id, { ...site, bodyContains: "Welcome" });
    await db.update(schema.monitors).set({ state: "down" }).where(eq(schema.monitors.id, m.id));

    expect((await updateMonitor(db, owner, org.id, m.id, { name: "Renamed" })).state).toBe("down");
    // HEAD while the stored keyword check remains is refused, even though the patch alone is valid.
    await expect(updateMonitor(db, owner, org.id, m.id, { method: "HEAD" })).rejects.toThrow(/GET/);
    await expect(updateMonitor(db, owner, org.id, m.id, { intervalSeconds: 30, timeoutMs: 30000 })).rejects.toThrow(/shorter/);
    const moved = await updateMonitor(db, owner, org.id, m.id, { url: "https://example.org" });
    expect(moved).toMatchObject({ url: "https://example.org", state: "unknown" });
  });

  it("deletes", async () => {
    const { owner, org } = await setup();
    const m = await createMonitor(db, owner, org.id, site);
    await deleteMonitor(db, owner, org.id, m.id);
    await rejectsWith(getMonitor(db, owner, org.id, m.id), "NOT_FOUND");
    await rejectsWith(deleteMonitor(db, owner, org.id, m.id), "NOT_FOUND");
  });

  it(`caps an organization at ${MAX_MONITORS_PER_ORGANIZATION} monitors`, async () => {
    const { owner, org } = await setup();
    await db.insert(schema.monitors).values(
      Array.from({ length: MAX_MONITORS_PER_ORGANIZATION }, (_, i) => ({ orgId: org.id, name: `m${i}`, url: "https://example.com" })),
    );
    await rejectsWith(createMonitor(db, owner, org.id, site), "RATE_LIMITED");
  });
});

describe("custom headers", () => {
  it("are encrypted at rest, never returned, and decryptable by the server", async () => {
    const { owner, org } = await setup();
    const headers = [{ name: "Authorization", value: "Bearer top-secret-token" }];
    const m = await createMonitor(db, owner, org.id, { ...site, headers });

    expect(JSON.stringify(m)).not.toContain("top-secret-token");
    expect(m.headerNames).toEqual(["Authorization"]);
    const [row] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, m.id));
    expect(row!.headersCiphertext!.toString("latin1")).not.toContain("top-secret-token");
    expect(decryptMonitorHeaders(row!)).toEqual(headers);
  });

  it("are kept when omitted from an update and replaced when provided", async () => {
    const { owner, org } = await setup();
    const m = await createMonitor(db, owner, org.id, { ...site, headers: [{ name: "X-Key", value: "one" }] });
    await updateMonitor(db, owner, org.id, m.id, { name: "Renamed" });
    let [row] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, m.id));
    expect(decryptMonitorHeaders(row!)).toEqual([{ name: "X-Key", value: "one" }]);

    await updateMonitor(db, owner, org.id, m.id, { headers: [] });
    [row] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, m.id));
    expect(row!.headersCiphertext).toBeNull();
    expect(row!.headerNames).toEqual([]);
  });

  it("cannot be decrypted after being copied onto another organization's monitor", async () => {
    const a = await setup();
    const b = await setup();
    const ma = await createMonitor(db, a.owner, a.org.id, { ...site, headers: [{ name: "X-Key", value: "secret" }] });
    const mb = await createMonitor(db, b.owner, b.org.id, site);
    const [rowA] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, ma.id));
    expect(() => decryptMonitorHeaders({ orgId: b.org.id, id: mb.id, headersCiphertext: rowA!.headersCiphertext })).toThrow();
  });
});

describe("permissions and tenant isolation", () => {
  it("lets viewers read but not write", async () => {
    const { owner, org } = await setup();
    const viewer = await addMember(owner, org.id, "viewer");
    const m = await createMonitor(db, owner, org.id, site);

    expect((await getMonitor(db, viewer, org.id, m.id)).id).toBe(m.id);
    expect((await listMonitors(db, viewer, org.id, {})).data).toHaveLength(1);
    await rejectsWith(createMonitor(db, viewer, org.id, site), "FORBIDDEN");
    await rejectsWith(updateMonitor(db, viewer, org.id, m.id, { name: "x" }), "FORBIDDEN");
    await rejectsWith(pauseMonitor(db, viewer, org.id, m.id), "FORBIDDEN");
    await rejectsWith(deleteMonitor(db, viewer, org.id, m.id), "FORBIDDEN");
  });

  it("lets members manage monitors", async () => {
    const { owner, org } = await setup();
    const member = await addMember(owner, org.id, "member");
    const m = await createMonitor(db, member, org.id, site);
    await pauseMonitor(db, member, org.id, m.id);
    await deleteMonitor(db, member, org.id, m.id);
  });

  it("never exposes or modifies another organization's monitors", async () => {
    const a = await setup();
    const b = await setup();
    const mA = await createMonitor(db, a.owner, a.org.id, site);

    // B's owner, using A's org id: not a member.
    await rejectsWith(getMonitor(db, b.owner, a.org.id, mA.id), "NOT_FOUND");
    await rejectsWith(listMonitors(db, b.owner, a.org.id, {}), "NOT_FOUND");
    // B's owner, using B's org id with A's monitor id: the monitor is not in B.
    await rejectsWith(getMonitor(db, b.owner, b.org.id, mA.id), "NOT_FOUND");
    await rejectsWith(updateMonitor(db, b.owner, b.org.id, mA.id, { name: "pwned" }), "NOT_FOUND");
    await rejectsWith(pauseMonitor(db, b.owner, b.org.id, mA.id), "NOT_FOUND");
    await rejectsWith(deleteMonitor(db, b.owner, b.org.id, mA.id), "NOT_FOUND");
    expect((await listMonitors(db, b.owner, b.org.id, {})).data).toEqual([]);
    expect((await getMonitor(db, a.owner, a.org.id, mA.id)).name).toBe("Website");
  });
});

describe("database constraints", () => {
  it("refuse HEAD with a keyword check and a timeout not below the interval", async () => {
    const { org } = await setup();
    const base = { orgId: org.id, name: "x", url: "https://example.com" };
    await expect(db.insert(schema.monitors).values({ ...base, method: "HEAD", bodyContains: "ok" })).rejects.toThrow();
    await expect(db.insert(schema.monitors).values({ ...base, intervalSeconds: 30, timeoutMs: 30000 })).rejects.toThrow();
    await expect(db.insert(schema.monitors).values({ ...base, intervalSeconds: 45 })).rejects.toThrow();
    await expect(db.insert(schema.monitors).values({ ...base, url: "ftp://example.com" })).rejects.toThrow();
  });
});

describe("listing", () => {
  it("paginates with a stable cursor, filters and searches", async () => {
    const { owner, org } = await setup();
    for (let i = 0; i < 7; i++) {
      await createMonitor(db, owner, org.id, { name: `Service ${i}`, url: `https://s${i}.example.com` });
    }
    const special = await createMonitor(db, owner, org.id, { name: "100%_billing", url: "https://billing.example.com" });
    await pauseMonitor(db, owner, org.id, special.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listMonitors(db, owner, org.id, { limit: 3, ...(cursor ? { cursor } : {}) });
      seen.push(...page.data.map((m) => m.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
    expect(seen[0]).toBe(special.id); // newest first

    expect((await listMonitors(db, owner, org.id, { state: "paused" })).data.map((m) => m.id)).toEqual([special.id]);
    expect((await listMonitors(db, owner, org.id, { q: "s3.example" })).data).toHaveLength(1);
    // LIKE wildcards in the search are literal.
    expect((await listMonitors(db, owner, org.id, { q: "%_" })).data.map((m) => m.id)).toEqual([special.id]);
    await rejectsWith(listMonitors(db, owner, org.id, { cursor: "garbage" }), "VALIDATION_ERROR");

    expect(await monitorSummary(db, owner, org.id)).toMatchObject({ total: 8, active: 7 });
  });
});
