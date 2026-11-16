import { schema, type Database } from "@uptimewatch/db";
import { closeActiveIncident } from "@uptimewatch/domain";
import type { EmailMessage, EmailSender, SendOptions } from "@uptimewatch/email";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { completeCheck, reserveCheck, type CheckOutcome } from "../src/jobs/checks";
import { MAX_DELIVERY_ATTEMPTS, fanOutIncidentEvent, sendDueDeliveries } from "../src/jobs/notifications";
import { scheduleDueChecks } from "../src/jobs/scheduler";
import { connect, reset, seedMonitors } from "./helpers";

let db: Database;
let close: () => Promise<void>;
beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());
beforeEach(() => reset(db));

const base = Math.floor(Date.now() / 60_000) * 60_000;
const at = (minute: number) => new Date(base + minute * 60_000);
const up: CheckOutcome = { state: "up", httpStatus: 200, latencyMs: 10 };
const down: CheckOutcome = { state: "down", httpStatus: 503, errorCode: "UNEXPECTED_STATUS", errorMessage: "Expected 200–299, got 503" };

async function result(monitorId: string, minute: number, outcome: CheckOutcome) {
  await db.update(schema.monitors).set({ nextCheckAt: at(minute) }).where(eq(schema.monitors.id, monitorId));
  await scheduleDueChecks(db, { now: at(minute) });
  const [check] = await db.select().from(schema.monitorChecks).where(eq(schema.monitorChecks.scheduledFor, at(minute)));
  const r = await reserveCheck(db, { checkId: check!.id, orgId: check!.orgId, monitorId, scheduledFor: at(minute).toISOString(), attempt: 0 }, at(minute));
  return completeCheck(db, r!, outcome, at(minute));
}

const incidentEvents = async () =>
  (await db.select().from(schema.outboxEvents)).filter((e) => e.eventType.startsWith("incident.")).map((e) => e.eventType);

class FakeSender implements EmailSender {
  sent: { message: EmailMessage; options?: SendOptions }[] = [];
  failNext = 0;
  async send(message: EmailMessage, options?: SendOptions) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("provider unavailable");
    }
    this.sent.push({ message, ...(options ? { options } : {}) });
    return { id: `msg-${this.sent.length}` };
  }
}

describe("incident engine", () => {
  it("opens one incident at the second failure and resolves it after two successes", async () => {
    const { monitors } = await seedMonitors(db, 1, at(0));
    const id = monitors[0]!.id;
    await result(id, 0, up);
    await result(id, 1, down);
    expect(await db.select().from(schema.incidents)).toHaveLength(0); // one failure: degraded only

    await result(id, 2, down);
    let [incident] = await db.select().from(schema.incidents);
    expect(incident).toMatchObject({
      status: "open",
      causeCode: "UNEXPECTED_STATUS",
      failedCheckCount: 2,
      title: "m0 is down",
    });
    expect(incident!.openedAt.getTime()).toBe(at(1).getTime()); // start of the outage = first failure
    expect(incident!.detectedAt.getTime()).toBe(at(2).getTime()); // confirmation

    await result(id, 3, down);
    await result(id, 4, up); // recovering
    [incident] = await db.select().from(schema.incidents);
    expect(incident).toMatchObject({ status: "open", failedCheckCount: 3 });

    await result(id, 5, up);
    [incident] = await db.select().from(schema.incidents);
    expect(incident).toMatchObject({ status: "resolved" });
    expect(incident!.resolvedAt!.getTime()).toBe(at(5).getTime());

    expect(await incidentEvents()).toEqual(["incident.opened", "incident.resolved"]);
    const updates = await db.select().from(schema.incidentUpdates).where(eq(schema.incidentUpdates.incidentId, incident!.id));
    expect(updates.map((u) => u.status).sort()).toEqual(["investigating", "resolved"]);
  });

  it("never holds two active incidents for one monitor", async () => {
    const { monitors } = await seedMonitors(db, 1, at(0));
    const id = monitors[0]!.id;
    for (let i = 0; i < 6; i++) await result(id, i, down);
    expect(await db.select().from(schema.incidents)).toHaveLength(1);
    expect(await incidentEvents()).toEqual(["incident.opened"]);
  });

  it("opens a new incident for a new outage", async () => {
    const { monitors } = await seedMonitors(db, 1, at(0));
    const id = monitors[0]!.id;
    for (const [i, o] of [down, down, up, up, down, down].entries()) await result(id, i, o);
    const all = await db.select().from(schema.incidents);
    expect(all.map((i) => i.status).sort()).toEqual(["open", "resolved"]);
  });

  it("closes the active incident without notification when monitoring is reset", async () => {
    const { monitors, ownerId, orgId } = await seedMonitors(db, 1, at(0));
    const id = monitors[0]!.id;
    await result(id, 0, down);
    await result(id, 1, down);
    await db.transaction((tx) => closeActiveIncident(tx, orgId, id, at(2), ownerId, "paused"));
    const [incident] = await db.select().from(schema.incidents);
    expect(incident!.status).toBe("resolved");
    expect(await incidentEvents()).toEqual(["incident.opened"]);
  });
});

describe("notifications", () => {
  async function openIncident() {
    const seeded = await seedMonitors(db, 1, at(0));
    const id = seeded.monitors[0]!.id;
    await result(id, 0, down);
    await result(id, 1, down);
    const [incident] = await db.select().from(schema.incidents);
    return { ...seeded, incidentId: incident!.id };
  }

  async function addMember(orgId: string, prefs?: Partial<typeof schema.notificationPreferences.$inferInsert>, verified = true) {
    const userId = randomUUID();
    await db.insert(schema.user).values({ id: userId, name: "Member", email: `${userId}@example.test`, emailVerified: verified });
    await db.insert(schema.organizationMembers).values({ orgId, userId, role: "viewer" });
    if (prefs) await db.insert(schema.notificationPreferences).values({ orgId, userId, ...prefs });
    return userId;
  }

  it("sends each member one email per event, even when the job runs twice", async () => {
    const { orgId, incidentId } = await openIncident();
    await addMember(orgId);
    const sender = new FakeSender();
    const event = { incidentId, orgId, eventType: "incident.opened" as const };

    expect(await fanOutIncidentEvent(db, event)).toBe(2);
    expect(await fanOutIncidentEvent(db, event)).toBe(0); // duplicate job: no new deliveries
    expect(await sendDueDeliveries(db, sender)).toMatchObject({ sent: 2 });
    expect(await sendDueDeliveries(db, sender)).toMatchObject({ sent: 0 });
    expect(sender.sent).toHaveLength(2);

    const { message, options } = sender.sent[0]!;
    expect(message.subject).toBe("[Down] m0 — Unexpected status code");
    expect(message.text).toContain("got 503");
    expect(message.text).toContain(`/app/${orgId}/incidents/${incidentId}`);
    expect(options?.idempotencyKey).toMatch(/^delivery-/);
  });

  it("respects preferences and skips unverified accounts", async () => {
    const { orgId, incidentId } = await openIncident();
    await addMember(orgId, { enabled: false });
    await addMember(orgId, { incidentOpened: false });
    const resolvedOnly = await addMember(orgId, { incidentOpened: false, incidentResolved: true });
    await addMember(orgId, undefined, false);

    expect(await fanOutIncidentEvent(db, { incidentId, orgId, eventType: "incident.opened" })).toBe(1); // the owner
    expect(await fanOutIncidentEvent(db, { incidentId, orgId, eventType: "incident.resolved" })).toBe(3); // owner, 2 opted-in
    const resolvedFor = await db
      .select()
      .from(schema.notificationDeliveries)
      .where(and(eq(schema.notificationDeliveries.userId, resolvedOnly), eq(schema.notificationDeliveries.eventType, "incident.resolved")));
    expect(resolvedFor).toHaveLength(1);
  });

  it("retries with exponential backoff, then gives up", async () => {
    const { orgId, incidentId } = await openIncident();
    const sender = new FakeSender();
    await fanOutIncidentEvent(db, { incidentId, orgId, eventType: "incident.opened" });

    sender.failNext = 1;
    const t0 = new Date();
    expect(await sendDueDeliveries(db, sender, { now: t0 })).toMatchObject({ retrying: 1 });
    expect(await sendDueDeliveries(db, sender, { now: new Date(t0.getTime() + 10_000) })).toMatchObject({ sent: 0 }); // not due yet
    expect(await sendDueDeliveries(db, sender, { now: new Date(t0.getTime() + 31_000) })).toMatchObject({ sent: 1 });
    const [d] = await db.select().from(schema.notificationDeliveries);
    expect(d).toMatchObject({ status: "sent", attempts: 2, providerMessageId: "msg-1" });

    // A delivery that keeps failing is marked failed after the maximum number of attempts.
    await db.update(schema.notificationDeliveries).set({ status: "pending", attempts: 0, nextAttemptAt: t0 });
    sender.failNext = 100;
    let now = t0;
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
      await sendDueDeliveries(db, sender, { now });
      now = new Date(now.getTime() + 2 * 3_600_000);
    }
    const [failed] = await db.select().from(schema.notificationDeliveries);
    expect(failed).toMatchObject({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: "provider unavailable" });
  });

  it("does not send the same delivery from two concurrent sweeps", async () => {
    const { orgId, incidentId } = await openIncident();
    for (let i = 0; i < 5; i++) await addMember(orgId);
    await fanOutIncidentEvent(db, { incidentId, orgId, eventType: "incident.opened" });
    const sender = new FakeSender();
    await Promise.all([sendDueDeliveries(db, sender), sendDueDeliveries(db, sender), sendDueDeliveries(db, sender)]);
    expect(sender.sent).toHaveLength(6);
    expect(new Set(sender.sent.map((s) => s.options?.idempotencyKey)).size).toBe(6);
  });

  it("writes a resolution email with the outage duration", async () => {
    const { orgId, incidentId, monitors } = await openIncident();
    await result(monitors[0]!.id, 2, up);
    await result(monitors[0]!.id, 3, up);
    await fanOutIncidentEvent(db, { incidentId, orgId, eventType: "incident.resolved" });
    const sender = new FakeSender();
    await sendDueDeliveries(db, sender);
    expect(sender.sent[0]!.message.subject).toBe("[Resolved] m0 is back up");
    expect(sender.sent[0]!.message.text).toContain("after 3 min of downtime");
  });
});
