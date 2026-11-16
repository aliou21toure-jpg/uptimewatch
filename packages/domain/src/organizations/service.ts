import { schema, type Database, type Executor } from "@uptimewatch/db";
import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { DomainError, conflict, forbidden, notFound } from "../errors";
import { can, canAssignRole, type Action, type MemberRole } from "./permissions";
import {
  acceptInvitationInput,
  createInvitationInput,
  createOrganizationInput,
  slugify,
  updateMemberRoleInput,
} from "./schemas";

const { organizations, organizationMembers, organizationInvitations, user } = schema;

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_INVITATIONS = 25;
export const MAX_ORGANIZATIONS_PER_USER = 10;

/** The authenticated user performing an operation. */
export interface Actor {
  userId: string;
}

export interface Membership {
  orgId: string;
  userId: string;
  role: MemberRole;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The tenant gate. Every organization-scoped operation starts here: it loads the actor's
 * membership and checks the action. Non-members get NOT_FOUND, so the existence of other
 * organizations is never revealed; members lacking the permission get FORBIDDEN.
 */
export async function authorize(
  db: Executor,
  actor: Actor,
  orgId: string,
  action: Action,
): Promise<Membership> {
  if (!UUID_RE.test(orgId)) throw notFound("Organization");
  const [membership] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, actor.userId)))
    .limit(1);
  if (!membership) throw notFound("Organization");
  if (!can(membership.role, action)) throw forbidden();
  return { orgId, userId: actor.userId, role: membership.role };
}

const isUniqueViolation = (error: unknown, constraint?: string) => {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const e = cause as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
};

export async function createOrganization(db: Database, actor: Actor, raw: unknown) {
  const input = createOrganizationInput.parse(raw);

  const [{ value: owned } = { value: 0 }] = await db
    .select({ value: count() })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, actor.userId), eq(organizationMembers.role, "owner")));
  if (owned >= MAX_ORGANIZATIONS_PER_USER) {
    throw new DomainError("RATE_LIMITED", `You can own at most ${MAX_ORGANIZATIONS_PER_USER} organizations`);
  }

  const base = input.slug ?? slugify(input.name);
  // An explicit slug must be available; a generated one gets a short random suffix on collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 92)}-${randomBytes(3).toString("hex")}`;
    try {
      return await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({ name: input.name, slug, createdBy: actor.userId })
          .returning();
        await tx.insert(organizationMembers).values({ orgId: org!.id, userId: actor.userId, role: "owner" });
        return { ...org!, role: "owner" as const };
      });
    } catch (error) {
      if (!isUniqueViolation(error, "organizations_slug_unique")) throw error;
      if (input.slug) throw conflict("This URL slug is already taken");
    }
  }
  throw conflict("Could not allocate a unique slug, please choose one");
}

export async function listOrganizationsForUser(db: Executor, actor: Actor) {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(eq(organizationMembers.userId, actor.userId))
    .orderBy(asc(organizations.name));
}

export async function getOrganization(db: Executor, actor: Actor, orgId: string) {
  const membership = await authorize(db, actor, orgId, "organization:read");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw notFound("Organization");
  const [{ value: memberCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(organizationMembers)
    .where(eq(organizationMembers.orgId, orgId));
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt,
    memberCount,
    role: membership.role,
  };
}

export async function listMembers(db: Executor, actor: Actor, orgId: string) {
  await authorize(db, actor, orgId, "member:read");
  return db
    .select({
      userId: organizationMembers.userId,
      name: user.name,
      email: user.email,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
    })
    .from(organizationMembers)
    .innerJoin(user, eq(user.id, organizationMembers.userId))
    .where(eq(organizationMembers.orgId, orgId))
    .orderBy(asc(organizationMembers.joinedAt));
}

async function countOwners(tx: Executor, orgId: string): Promise<number> {
  // Lock the owner rows so two concurrent demotions cannot both pass the "last owner" check.
  const rows = await tx
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, "owner")))
    .for("update");
  return rows.length;
}

export async function updateMemberRole(
  db: Database,
  actor: Actor,
  orgId: string,
  targetUserId: string,
  raw: unknown,
) {
  const { role: newRole } = updateMemberRoleInput.parse(raw);
  return db.transaction(async (tx) => {
    const me = await authorize(tx, actor, orgId, "member:update-role");
    const [target] = await tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, targetUserId)))
      .for("update");
    if (!target) throw notFound("Member");
    if (!canAssignRole(me.role, target.role, newRole)) {
      throw forbidden("Only owners can grant, change or remove the owner role");
    }
    if (target.role === "owner" && newRole !== "owner" && (await countOwners(tx, orgId)) <= 1) {
      throw conflict("An organization must keep at least one owner");
    }
    const [updated] = await tx
      .update(organizationMembers)
      .set({ role: newRole })
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, targetUserId)))
      .returning();
    return updated!;
  });
}

export async function removeMember(db: Database, actor: Actor, orgId: string, targetUserId: string) {
  return db.transaction(async (tx) => {
    const isSelf = targetUserId === actor.userId;
    // Anyone may leave an organization; removing someone else needs the permission.
    const me = await authorize(tx, actor, orgId, isSelf ? "organization:read" : "member:remove");
    const [target] = await tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, targetUserId)))
      .for("update");
    if (!target) throw notFound("Member");
    if (!isSelf && !canAssignRole(me.role, target.role, null)) {
      throw forbidden("Only owners can remove an owner");
    }
    if (target.role === "owner" && (await countOwners(tx, orgId)) <= 1) {
      throw conflict("An organization must keep at least one owner");
    }
    await tx
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, targetUserId)));
  });
}

// ---------------------------------------------------------------- invitations

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createInvitation(
  db: Database,
  actor: Actor,
  orgId: string,
  raw: unknown,
  now: Date = new Date(),
) {
  const input = createInvitationInput.parse(raw);
  return db.transaction(async (tx) => {
    await authorize(tx, actor, orgId, "member:invite");

    const [alreadyMember] = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .innerJoin(user, eq(user.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.orgId, orgId), sql`lower(${user.email}) = ${input.email}`))
      .limit(1);
    if (alreadyMember) throw conflict("This person is already a member");

    const [{ value: pending } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.orgId, orgId),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
          gt(organizationInvitations.expiresAt, now),
        ),
      );
    if (pending >= MAX_PENDING_INVITATIONS) {
      throw new DomainError("RATE_LIMITED", "Too many pending invitations for this organization");
    }

    // Re-inviting replaces any earlier pending invitation (including an expired one).
    await tx
      .update(organizationInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(organizationInvitations.orgId, orgId),
          eq(organizationInvitations.email, input.email),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
        ),
      );

    // The raw token is returned once (for the email link) and only its hash is stored.
    const token = randomBytes(32).toString("base64url");
    const [invitation] = await tx
      .insert(organizationInvitations)
      .values({
        orgId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedBy: actor.userId,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      })
      .returning({
        id: organizationInvitations.id,
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        expiresAt: organizationInvitations.expiresAt,
      });
    const [org] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return { invitation: invitation!, token, organizationName: org!.name };
  });
}

export async function listPendingInvitations(db: Executor, actor: Actor, orgId: string, now = new Date()) {
  await authorize(db, actor, orgId, "member:invite");
  return db
    .select({
      id: organizationInvitations.id,
      email: organizationInvitations.email,
      role: organizationInvitations.role,
      expiresAt: organizationInvitations.expiresAt,
      createdAt: organizationInvitations.createdAt,
    })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.orgId, orgId),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
        gt(organizationInvitations.expiresAt, now),
      ),
    )
    .orderBy(desc(organizationInvitations.createdAt));
}

export async function revokeInvitation(db: Database, actor: Actor, orgId: string, invitationId: string) {
  await authorize(db, actor, orgId, "member:invite");
  if (!UUID_RE.test(invitationId)) throw notFound("Invitation");
  const [revoked] = await db
    .update(organizationInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(organizationInvitations.id, invitationId),
        eq(organizationInvitations.orgId, orgId), // tenant scope: an id from another org never matches
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
      ),
    )
    .returning({ id: organizationInvitations.id });
  if (!revoked) throw notFound("Invitation");
}

/** Public preview of an invitation (for the accept page). Reveals nothing for an invalid token. */
export async function previewInvitation(db: Executor, token: string, now = new Date()) {
  const [row] = await db
    .select({
      email: organizationInvitations.email,
      role: organizationInvitations.role,
      organizationName: organizations.name,
    })
    .from(organizationInvitations)
    .innerJoin(organizations, eq(organizations.id, organizationInvitations.orgId))
    .where(
      and(
        eq(organizationInvitations.tokenHash, hashToken(token)),
        isNull(organizationInvitations.acceptedAt),
        isNull(organizationInvitations.revokedAt),
        gt(organizationInvitations.expiresAt, now),
      ),
    );
  return row ?? null;
}

export interface AcceptingUser {
  userId: string;
  email: string;
  emailVerified: boolean;
}

export async function acceptInvitation(
  db: Database,
  acceptingUser: AcceptingUser,
  raw: unknown,
  now: Date = new Date(),
) {
  const { token } = acceptInvitationInput.parse(raw);
  if (!acceptingUser.emailVerified) {
    throw forbidden("Verify your email address before accepting an invitation");
  }
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.tokenHash, hashToken(token)))
      .for("update");
    // One generic error for unknown, used, revoked and expired tokens.
    const invalid = () => notFound("Invitation");
    if (!invitation || invitation.acceptedAt || invitation.revokedAt) throw invalid();
    if (invitation.expiresAt <= now) throw invalid();
    if (invitation.email !== acceptingUser.email.toLowerCase()) {
      throw forbidden("This invitation was sent to a different email address");
    }

    await tx
      .insert(organizationMembers)
      .values({ orgId: invitation.orgId, userId: acceptingUser.userId, role: invitation.role })
      .onConflictDoNothing();
    await tx
      .update(organizationInvitations)
      .set({ acceptedAt: now, acceptedBy: acceptingUser.userId })
      .where(eq(organizationInvitations.id, invitation.id));
    return { orgId: invitation.orgId };
  });
}
