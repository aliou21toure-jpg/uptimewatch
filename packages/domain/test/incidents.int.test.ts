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
  getIncident,
  getNotificationPreferences,
  listIncidents,
  pauseMonitor,
  recordIncidentEffects,
  updateMonitor,
  updateNotificationPreferences,
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

async function setupWithIncident() {
  const owner = await createUser(db);
  const org = await createOrganization(db, owner, { name: "Acme" });
  const monitor = await createMonitor(db, owner, org.id, { name: "API", url: "https://api.example.com" });
  const now = new Date();
  const opened = await db.transaction((tx) =>
    recordIncidentEffects(tx, "incident_opened", {
      monitor: { id: monitor.id, orgId: org.id, name: monitor.name },
      slot: now,
      failingSince: new Date(now.getTime() - 60_000),
      outcome: "down",
      errorCode: "TIMEOUT",
      errorMessage: "No complete response within 10s",
      now,
    }),
  );
  return { owner, org, monitor, incidentId: opened!.incidentId };
}

async function addMember(owner: { userId: string }, orgId: string, role: "member" | "viewer") {
  const u = await createUser(db);
  const { token } = await createInvitation(db, owner, orgId, { email: u.email, role });
  await acceptInvitation(db, u, { token });
  return u;
}

describe("incidents", () => {
  it("lists and shows incidents with their timeline", async () => {
    const { owner, org, incidentId } = await setupWithIncident();
    const list = await listIncidents(db, owner, org.id, { status: "active" });
    expect(list.data).toEqual([expect.objectContaining({ id: incidentId, monitorName: "API", status: "open", causeCode: "TIMEOUT" })]);
    expect((await listIncidents(db, owner, org.id, { status: "resolved" })).data).toEqual([]);

    const detail = await getIncident(db, owner, org.id, incidentId);
    expect(detail.updates).toHaveLength(1);
    expect(detail.updates[0]).toMatchObject({ status: "investigating", authorName: null });
  });

  it("lets members acknowledge and post updates, but not viewers", async () => {
    const { owner, org, incidentId } = await setupWithIncident();
    const viewer = await addMember(owner, org.id, "viewer");
    const member = await addMember(owner, org.id, "member");

    await rejectsWith(acknowledgeIncident(db, viewer, org.id, incidentId), "FORBIDDEN");
    await rejectsWith(addIncidentUpdate(db, viewer, org.id, incidentId, { status: "identified", message: "x" }), "FORBIDDEN");

    await acknowledgeIncident(db, member, org.id, incidentId);
    await acknowledgeIncident(db, member, org.id, incidentId); // idempotent
    await addIncidentUpdate(db, member, org.id, incidentId, { status: "identified", message: "Database failover in progress" });
    const detail = await getIncident(db, viewer, org.id, incidentId);
    expect(detail.status).toBe("acknowledged");
    expect(detail.acknowledgedByName).toBeTruthy();
    expect(detail.updates.map((u) => u.status)).toEqual(["investigating", "investigating", "identified"]);
  });

  it("does not allow resolving by hand or updating a resolved incident", async () => {
    const { owner, org, incidentId, monitor } = await setupWithIncident();
    await expect(addIncidentUpdate(db, owner, org.id, incidentId, { status: "resolved", message: "done" })).rejects.toThrow();
    await pauseMonitor(db, owner, org.id, monitor.id); // closes the incident
    await rejectsWith(addIncidentUpdate(db, owner, org.id, incidentId, { status: "monitoring", message: "x" }), "CONFLICT");
    await rejectsWith(acknowledgeIncident(db, owner, org.id, incidentId), "CONFLICT");
  });

  it("closes the active incident when the monitored URL changes", async () => {
    const { owner, org, incidentId, monitor } = await setupWithIncident();
    await updateMonitor(db, owner, org.id, monitor.id, { url: "https://new.example.com" });
    const detail = await getIncident(db, owner, org.id, incidentId);
    expect(detail.status).toBe("resolved");
    expect(detail.updates.at(-1)!.message).toMatch(/URL changed/);
  });

  it("is isolated between organizations", async () => {
    const a = await setupWithIncident();
    const b = await setupWithIncident();
    await rejectsWith(getIncident(db, b.owner, a.org.id, a.incidentId), "NOT_FOUND");
    await rejectsWith(getIncident(db, b.owner, b.org.id, a.incidentId), "NOT_FOUND");
    await rejectsWith(acknowledgeIncident(db, b.owner, b.org.id, a.incidentId), "NOT_FOUND");
    await rejectsWith(addIncidentUpdate(db, b.owner, b.org.id, a.incidentId, { status: "identified", message: "x" }), "NOT_FOUND");
    expect((await listIncidents(db, b.owner, b.org.id, {})).data.map((i) => i.id)).toEqual([b.incidentId]);
  });

  it("cannot attach an update to another organization's incident at the database level", async () => {
    const a = await setupWithIncident();
    const b = await setupWithIncident();
    await expect(
      db.insert(schema.incidentUpdates).values({ orgId: b.org.id, incidentId: a.incidentId, status: "identified", message: "x" }),
    ).rejects.toThrow();
  });

  it("allows only one active incident per monitor at the database level", async () => {
    const { org, monitor } = await setupWithIncident();
    const now = new Date();
    await expect(
      db.insert(schema.incidents).values({ orgId: org.id, monitorId: monitor.id, title: "dup", openedAt: now, detectedAt: now }),
    ).rejects.toThrow();
  });
});

describe("notification preferences", () => {
  it("default to everything on and can be changed per organization", async () => {
    const { owner, org } = await setupWithIncident();
    expect(await getNotificationPreferences(db, owner, org.id)).toEqual({ enabled: true, incidentOpened: true, incidentResolved: true });
    await updateNotificationPreferences(db, owner, org.id, { incidentResolved: false });
    expect(await getNotificationPreferences(db, owner, org.id)).toEqual({ enabled: true, incidentOpened: true, incidentResolved: false });
    await expect(updateNotificationPreferences(db, owner, org.id, { userId: "someone-else" })).rejects.toThrow();
    const [row] = await db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.orgId, org.id));
    expect(row!.userId).toBe(owner.userId);
  });
});
