import type { Database } from "@uptimewatch/db";
import { schema } from "@uptimewatch/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  INVITATION_TTL_MS,
  acceptInvitation,
  createInvitation,
  createOrganization,
  getOrganization,
  listMembers,
  listOrganizationsForUser,
  listPendingInvitations,
  previewInvitation,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  type DomainErrorCode,
} from "../src/index";
import { connect, createUser, resetDatabase } from "./helpers";

let db: Database;
let close: () => Promise<void>;

beforeAll(() => ({ db, close } = connect()));
afterAll(() => close());
beforeEach(() => resetDatabase(db));

const rejectsWith = (promise: Promise<unknown>, code: DomainErrorCode) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", code });

async function orgWithMember(role: "admin" | "member" | "viewer") {
  const owner = await createUser(db);
  const other = await createUser(db);
  const org = await createOrganization(db, owner, { name: "Acme Corp" });
  const { token } = await createInvitation(db, owner, org.id, { email: other.email, role });
  await acceptInvitation(db, other, { token });
  return { owner, other, org };
}

describe("organizations", () => {
  it("creates an organization with the creator as owner and a generated slug", async () => {
    const alice = await createUser(db);
    const org = await createOrganization(db, alice, { name: "Acme Corp" });
    expect(org).toMatchObject({ name: "Acme Corp", slug: "acme-corp", role: "owner" });
    expect(await listOrganizationsForUser(db, alice)).toEqual([
      expect.objectContaining({ id: org.id, role: "owner" }),
    ]);
  });

  it("suffixes generated slugs on collision but rejects a taken explicit slug", async () => {
    const alice = await createUser(db);
    const first = await createOrganization(db, alice, { name: "Acme" });
    const second = await createOrganization(db, alice, { name: "Acme" });
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith("acme-")).toBe(true);
    await rejectsWith(createOrganization(db, alice, { name: "Other", slug: "acme" }), "CONFLICT");
  });
});

describe("tenant isolation", () => {
  it("hides another organization's existence from non-members", async () => {
    const alice = await createUser(db);
    const mallory = await createUser(db);
    const org = await createOrganization(db, alice, { name: "Alice Inc" });

    await rejectsWith(getOrganization(db, mallory, org.id), "NOT_FOUND");
    await rejectsWith(listMembers(db, mallory, org.id), "NOT_FOUND");
    await rejectsWith(createInvitation(db, mallory, org.id, { email: "x@y.co", role: "admin" }), "NOT_FOUND");
    await rejectsWith(updateMemberRole(db, mallory, org.id, alice.userId, { role: "viewer" }), "NOT_FOUND");
    await rejectsWith(removeMember(db, mallory, org.id, alice.userId), "NOT_FOUND");
    expect(await listOrganizationsForUser(db, mallory)).toEqual([]);
  });

  it("treats malformed organization ids as not found instead of erroring", async () => {
    const alice = await createUser(db);
    await rejectsWith(getOrganization(db, alice, "not-a-uuid"), "NOT_FOUND");
    await rejectsWith(getOrganization(db, alice, "' OR 1=1 --"), "NOT_FOUND");
  });

  it("cannot revoke an invitation of another organization by id", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const orgA = await createOrganization(db, alice, { name: "Org A" });
    const orgB = await createOrganization(db, bob, { name: "Org B" });
    const { invitation } = await createInvitation(db, alice, orgA.id, { email: "x@y.co", role: "member" });

    // Bob is an owner of B, but A's invitation id must not resolve inside B.
    await rejectsWith(revokeInvitation(db, bob, orgB.id, invitation.id), "NOT_FOUND");
    expect(await listPendingInvitations(db, alice, orgA.id)).toHaveLength(1);
  });

  it("does not let membership in one organization grant rights in another", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const orgA = await createOrganization(db, alice, { name: "Org A" });
    await createOrganization(db, bob, { name: "Org B" });
    // Bob owns B; he still sees nothing of A.
    await rejectsWith(getOrganization(db, bob, orgA.id), "NOT_FOUND");
  });

  it("enforces organization ownership at the database level too", async () => {
    const alice = await createUser(db);
    await expect(
      db.insert(schema.organizationMembers).values({
        orgId: "00000000-0000-4000-8000-000000000000",
        userId: alice.userId,
        role: "owner",
      }),
    ).rejects.toThrow();
  });
});

describe("roles", () => {
  it("forbids a viewer from inviting or changing roles", async () => {
    const { owner, other: viewer, org } = await orgWithMember("viewer");
    await rejectsWith(createInvitation(db, viewer, org.id, { email: "x@y.co", role: "member" }), "FORBIDDEN");
    await rejectsWith(updateMemberRole(db, viewer, org.id, owner.userId, { role: "viewer" }), "FORBIDDEN");
    await rejectsWith(removeMember(db, viewer, org.id, owner.userId), "FORBIDDEN");
    // ...but can read.
    expect(await listMembers(db, viewer, org.id)).toHaveLength(2);
  });

  it("forbids a member from managing people", async () => {
    const { other: member, org } = await orgWithMember("member");
    await rejectsWith(createInvitation(db, member, org.id, { email: "x@y.co", role: "viewer" }), "FORBIDDEN");
  });

  it("lets an admin manage members but never owners", async () => {
    const { owner, other: admin, org } = await orgWithMember("admin");
    const carol = await createUser(db);
    const { token } = await createInvitation(db, admin, org.id, { email: carol.email, role: "viewer" });
    await acceptInvitation(db, carol, { token });

    await updateMemberRole(db, admin, org.id, carol.userId, { role: "member" });
    await rejectsWith(updateMemberRole(db, admin, org.id, carol.userId, { role: "owner" }), "FORBIDDEN");
    await rejectsWith(updateMemberRole(db, admin, org.id, owner.userId, { role: "viewer" }), "FORBIDDEN");
    await rejectsWith(removeMember(db, admin, org.id, owner.userId), "FORBIDDEN");
    await removeMember(db, admin, org.id, carol.userId);
    expect(await listMembers(db, owner, org.id)).toHaveLength(2);
  });

  it("always keeps at least one owner", async () => {
    const alice = await createUser(db);
    const org = await createOrganization(db, alice, { name: "Solo" });
    await rejectsWith(updateMemberRole(db, alice, org.id, alice.userId, { role: "admin" }), "CONFLICT");
    await rejectsWith(removeMember(db, alice, org.id, alice.userId), "CONFLICT");
  });

  it("lets an owner hand over ownership and then step down", async () => {
    const { owner, other, org } = await orgWithMember("admin");
    await updateMemberRole(db, owner, org.id, other.userId, { role: "owner" });
    await updateMemberRole(db, owner, org.id, owner.userId, { role: "viewer" });
    const roles = Object.fromEntries((await listMembers(db, other, org.id)).map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [owner.userId]: "viewer", [other.userId]: "owner" });
  });
});

describe("invitations", () => {
  it("stores only a hash of the token", async () => {
    const alice = await createUser(db);
    const org = await createOrganization(db, alice, { name: "Acme" });
    const { token, invitation } = await createInvitation(db, alice, org.id, { email: "Bob@Example.com", role: "member" });
    expect(invitation.email).toBe("bob@example.com");
    const [row] = await db
      .select()
      .from(schema.organizationInvitations)
      .where(eq(schema.organizationInvitations.id, invitation.id));
    expect(row!.tokenHash).not.toContain(token);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is single-use", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const org = await createOrganization(db, alice, { name: "Acme" });
    const { token } = await createInvitation(db, alice, org.id, { email: bob.email, role: "member" });
    expect(await previewInvitation(db, token)).toMatchObject({ organizationName: "Acme", role: "member" });
    await acceptInvitation(db, bob, { token });
    await rejectsWith(acceptInvitation(db, bob, { token }), "NOT_FOUND");
    expect(await previewInvitation(db, token)).toBeNull();
  });

  it("must be accepted by the invited, verified email address", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const eve = await createUser(db);
    const unverified = await createUser(db, { emailVerified: false });
    const org = await createOrganization(db, alice, { name: "Acme" });

    const { token } = await createInvitation(db, alice, org.id, { email: bob.email, role: "admin" });
    await rejectsWith(acceptInvitation(db, eve, { token }), "FORBIDDEN");

    const second = await createInvitation(db, alice, org.id, { email: unverified.email, role: "member" });
    await rejectsWith(acceptInvitation(db, unverified, { token: second.token }), "FORBIDDEN");
  });

  it("expires", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const org = await createOrganization(db, alice, { name: "Acme" });
    const { token } = await createInvitation(db, alice, org.id, { email: bob.email, role: "member" });
    const later = new Date(Date.now() + INVITATION_TTL_MS + 1000);
    await rejectsWith(acceptInvitation(db, bob, { token }, later), "NOT_FOUND");
  });

  it("is invalidated by revocation and by re-inviting", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const org = await createOrganization(db, alice, { name: "Acme" });
    const first = await createInvitation(db, alice, org.id, { email: bob.email, role: "member" });
    const second = await createInvitation(db, alice, org.id, { email: bob.email, role: "viewer" });
    await rejectsWith(acceptInvitation(db, bob, { token: first.token }), "NOT_FOUND");

    await revokeInvitation(db, alice, org.id, second.invitation.id);
    await rejectsWith(acceptInvitation(db, bob, { token: second.token }), "NOT_FOUND");
  });

  it("refuses to invite an existing member", async () => {
    const { owner, other, org } = await orgWithMember("member");
    await rejectsWith(createInvitation(db, owner, org.id, { email: other.email.toUpperCase(), role: "viewer" }), "CONFLICT");
  });

  it("grants the invited role", async () => {
    const { owner, other, org } = await orgWithMember("viewer");
    const [member] = await db
      .select()
      .from(schema.organizationMembers)
      .where(and(eq(schema.organizationMembers.orgId, org.id), eq(schema.organizationMembers.userId, other.userId)));
    expect(member!.role).toBe("viewer");
    expect(await listPendingInvitations(db, owner, org.id)).toEqual([]);
  });
});
