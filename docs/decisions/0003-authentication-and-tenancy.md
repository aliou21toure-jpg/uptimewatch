# 0003 — Authentication and multi-tenancy

**Status:** accepted · 2026-11-16

## Authentication
- **Better Auth** with email + password. Its four tables (`user`, `session`, `account`, `verification`) are
  declared in Drizzle so they live in the same migration history as the business tables.
- Email verification is **required** before sign-in; password reset revokes all other sessions.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` whenever `APP_URL` is HTTPS.
- Built-in rate limits: 5 sign-in / sign-up attempts per minute and 3 reset or verification emails per 5 minutes per IP.
  Storage is in-memory, which is correct for a single web instance; it must move to Redis before scaling the web app horizontally.

## Organizations are our own, not a Better Auth plugin
The specification requires UUID keys, composite foreign keys and server-side role checks owned by the
domain layer. Keeping organizations in `packages/domain` makes those rules explicit and testable without
the HTTP layer.

## The tenant gate
Every organization-scoped service starts with `authorize(db, actor, orgId, action)`:
1. Loads the actor's membership for `orgId` (malformed ids are rejected before reaching SQL).
2. **Non-members get `NOT_FOUND`**, never `FORBIDDEN`, so the existence of other organizations is not revealed.
3. Members lacking the permission get `FORBIDDEN`.
4. Child resources are always looked up with both their id **and** `org_id`, so an id from another organization never matches.

| Role | Read | Monitors & incidents | Members, settings, status pages |
|---|---|---|---|
| owner | ✓ | ✓ | ✓ (including the owner role) |
| admin | ✓ | ✓ | ✓ (cannot grant, change or remove owners) |
| member | ✓ | ✓ | — |
| viewer | ✓ | — | — |

Invariants enforced in transactions with row locks: an organization always keeps at least one owner.

## Invitations
- Token: 32 random bytes, sent once by email; only its SHA-256 hash is stored.
- Single-use, expires after 7 days, revocable; re-inviting the same address revokes the previous invitation.
- Must be accepted by a **verified** account whose email matches the invitation.
- Invalid, used, revoked and expired tokens all return the same `NOT_FOUND`.
- At most 25 pending invitations per organization; the owner role cannot be granted by invitation (DB check constraint).
- `Referrer-Policy: no-referrer` keeps tokens in URLs from leaking.

## CSRF
`SameSite=Lax` cookies already block cross-site writes. The API wrapper also rejects state-changing
requests whose `Origin` is not the app's own, or that browsers mark `Sec-Fetch-Site: cross-site`.

## Email
`EMAIL_TRANSPORT=console` prints emails to the server log (the default in development).
Production defaults to Resend and refuses to start without `RESEND_API_KEY` unless the console
transport is chosen explicitly (used for CI end-to-end runs).

## Testing
Integration tests run against real PostgreSQL: Testcontainers starts `postgres:17-alpine` by default
(CI); `TEST_DATABASE_URL` points them at an existing database for a faster local loop.
