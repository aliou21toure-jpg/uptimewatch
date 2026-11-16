import { schema, type Database } from "@uptimewatch/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  acknowledgeIncident,
  addIncidentUpdate,
  createInvitation,
  createMonitor,
  createOrganization,
  createStatusPage,
  deleteStatusPage,
  getPublicStatusPage,
  getStatusPage,
  listStatusPages,
  overallStatus,
  previewStatusPage,
  recordIncidentEffects,
  setStatusPageComponents,
  updateStatusPage,
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

const SECRET_URL = "https://internal-billing.example.com/health?token=s3cr3t";

async function setup(slug = "acme") {
  const owner = await createUser(db);
  const org = await createOrganization(db, owner, { name: "Acme" });
  const api = await createMonitor(db, owner, org.id, {
    name: "billing-prod-eu-1",
    url: SECRET_URL,
    bodyContains: "status-ok-keyword",
    headers: [{ name: "X-Internal-Token", value: "header-secret-value" }],
  });
  const web = await createMonitor(db, owner, org.id, { name: "Website", url: "https://www.example.com" });
  const page = await createStatusPage(db, owner, org.id, { title: "Acme Status", slug });
  await setStatusPageComponents(db, owner, org.id, page.id, [
    { monitorId: api.id, displayName: "Billing API" },
    { monitorId: web.id },
  ]);
  return { owner, org, api, web, page };
}

async function openIncident(orgId: string, monitor: { id: string; name: string }) {
  const now = new Date();
  return db.transaction((tx) =>
    recordIncidentEffects(tx, "incident_opened", {
      monitor: { id: monitor.id, orgId, name: monitor.name },
      slot: now,
      failingSince: now,
      outcome: "down",
      errorCode: "UNEXPECTED_STATUS",
      errorMessage: "Expected 200–299, got 503",
      now,
    }),
  );
}

describe("public status page", () => {
  it("shows components and incidents, and nothing private", async () => {
    const { owner, org, api } = await setup();
    const [ownerRow] = await db.select().from(schema.user).where(eq(schema.user.id, owner.userId));
    await db.update(schema.monitors).set({ state: "down" }).where(eq(schema.monitors.id, api.id));
    const opened = await openIncident(org.id, api);
    await acknowledgeIncident(db, owner, org.id, opened!.incidentId);
    await addIncidentUpdate(db, owner, org.id, opened!.incidentId, { status: "identified", message: "A database node failed over." });

    const view = (await getPublicStatusPage(db, "acme"))!;
    expect(view.title).toBe("Acme Status");
    expect(view.components.map((c) => [c.name, c.status])).toEqual([["Billing API", "outage"], ["Website", "unknown"]]);
    expect(view.overall).toBe("major_outage"); // the only watched component is down
    expect(view.incidents).toHaveLength(1);
    expect(view.incidents[0]).toMatchObject({ title: "Billing API is experiencing an outage", status: "ongoing" });
    expect(view.incidents[0]!.updates.map((u) => u.status)).toEqual(["identified", "investigating", "investigating"]);

    const json = JSON.stringify(view);
    for (const secret of [SECRET_URL, "internal-billing", "s3cr3t", "status-ok-keyword", "X-Internal-Token", "header-secret-value", "billing-prod-eu-1", api.id, org.id, owner.userId, owner.email, ownerRow!.name]) {
      expect(json).not.toContain(secret);
    }
  });

  it("is not served when private or unknown, and malformed slugs are rejected early", async () => {
    const { owner, org, page } = await setup();
    await updateStatusPage(db, owner, org.id, page.id, { isPublic: false });
    expect(await getPublicStatusPage(db, "acme")).toBeNull();
    expect(await getPublicStatusPage(db, "nope")).toBeNull();
    expect(await getPublicStatusPage(db, "../../etc")).toBeNull();
    // Members can still preview it.
    expect((await previewStatusPage(db, owner, org.id, page.id)).components).toHaveLength(2);
  });

  it("only lists incidents of the page's own components", async () => {
    const { owner, org } = await setup();
    const other = await createMonitor(db, owner, org.id, { name: "Not on the page", url: "https://other.example.com" });
    await openIncident(org.id, other);
    expect((await getPublicStatusPage(db, "acme"))!.incidents).toEqual([]);
  });
});

describe("overall status", () => {
  it("summarizes components, ignoring maintenance and unknown", () => {
    expect(overallStatus(["operational", "operational"])).toBe("operational");
    expect(overallStatus(["operational", "degraded"])).toBe("degraded");
    expect(overallStatus(["operational", "outage"])).toBe("partial_outage");
    expect(overallStatus(["outage", "maintenance"])).toBe("major_outage");
    expect(overallStatus(["maintenance", "unknown"])).toBe("unknown");
  });
});

describe("managing status pages", () => {
  it("enforces unique and valid slugs", async () => {
    const { owner, org } = await setup();
    await rejectsWith(createStatusPage(db, owner, org.id, { title: "x", slug: "acme" }), "CONFLICT");
    await expect(createStatusPage(db, owner, org.id, { title: "x", slug: "Bad Slug" })).rejects.toThrow();
    await expect(createStatusPage(db, owner, org.id, { title: "x", slug: "api" })).rejects.toThrow(/reserved/);
  });

  it("requires admin rights to change pages; members and viewers can read", async () => {
    const { owner, org, page } = await setup();
    for (const role of ["member", "viewer"] as const) {
      const u = await createUser(db);
      const { token } = await createInvitation(db, owner, org.id, { email: u.email, role });
      await acceptInvitation(db, u, { token });
      expect(await listStatusPages(db, u, org.id)).toEqual([expect.objectContaining({ slug: "acme", components: 2 })]);
      await rejectsWith(updateStatusPage(db, u, org.id, page.id, { title: "x" }), "FORBIDDEN");
      await rejectsWith(setStatusPageComponents(db, u, org.id, page.id, []), "FORBIDDEN");
      await rejectsWith(deleteStatusPage(db, u, org.id, page.id), "FORBIDDEN");
    }
  });

  it("cannot show another organization's monitor, through the service or the database", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    await rejectsWith(setStatusPageComponents(db, b.owner, b.org.id, b.page.id, [{ monitorId: a.api.id }]), "NOT_FOUND");
    await expect(
      db.insert(schema.statusPageMonitors).values({ orgId: b.org.id, statusPageId: b.page.id, monitorId: a.api.id }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.statusPageMonitors).values({ orgId: a.org.id, statusPageId: b.page.id, monitorId: a.api.id }),
    ).rejects.toThrow();
  });

  it("is invisible to other organizations", async () => {
    const a = await setup("acme");
    const b = await setup("beta");
    await rejectsWith(getStatusPage(db, b.owner, a.org.id, a.page.id), "NOT_FOUND");
    await rejectsWith(getStatusPage(db, b.owner, b.org.id, a.page.id), "NOT_FOUND");
    await rejectsWith(updateStatusPage(db, b.owner, b.org.id, a.page.id, { title: "pwned" }), "NOT_FOUND");
    await rejectsWith(deleteStatusPage(db, b.owner, b.org.id, a.page.id), "NOT_FOUND");
  });

  it("reports the slugs to refresh when a page moves or is deleted", async () => {
    const { owner, org, page } = await setup();
    expect((await updateStatusPage(db, owner, org.id, page.id, { slug: "acme-status" })).affectedSlugs.sort()).toEqual(["acme", "acme-status"]);
    expect(await getPublicStatusPage(db, "acme")).toBeNull();
    expect(await getPublicStatusPage(db, "acme-status")).not.toBeNull();
    expect((await deleteStatusPage(db, owner, org.id, page.id)).affectedSlugs).toEqual(["acme-status"]);
  });

  it("keeps component order and display names", async () => {
    const { owner, org, page, api, web } = await setup();
    await setStatusPageComponents(db, owner, org.id, page.id, [{ monitorId: web.id, displayName: "Site" }, { monitorId: api.id }]);
    const detail = await getStatusPage(db, owner, org.id, page.id);
    expect(detail.components.map((c) => c.displayName ?? c.monitorName)).toEqual(["Site", "billing-prod-eu-1"]);
    await expect(setStatusPageComponents(db, owner, org.id, page.id, [{ monitorId: web.id }, { monitorId: web.id }])).rejects.toThrow(/once/);
  });
});
