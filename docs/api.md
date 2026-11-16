# REST API

All `/api/v1` routes require a session cookie (sign in through `/api/auth/*`). Responses are JSON:
success bodies are `{ "data": ... }`, errors are normalized:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "details": [{ "path": "email", "message": "Invalid email address" }] } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Member without permission, or cross-site request |
| `NOT_FOUND` | 404 | Unknown resource **or** an organization you do not belong to |
| `CONFLICT` | 409 | Slug taken, already a member, last owner |
| `VALIDATION_ERROR` | 400 | Invalid JSON or input |
| `RATE_LIMITED` | 429 | Too many pending invitations / organizations |

## Authentication (Better Auth)
`POST /api/auth/sign-up/email` · `POST /api/auth/sign-in/email` · `POST /api/auth/sign-out` ·
`GET /api/auth/verify-email` · `POST /api/auth/request-password-reset` · `POST /api/auth/reset-password`

## Organizations
| Method | Path | Permission | Body |
|---|---|---|---|
| POST | `/api/v1/organizations` | any user | `{ name, slug? }` |
| GET | `/api/v1/organizations` | any user (own memberships) | |
| GET | `/api/v1/organizations/:orgId` | member | |
| GET | `/api/v1/organizations/:orgId/members` | member | |
| PATCH | `/api/v1/organizations/:orgId/members/:userId` | admin (owner for owner changes) | `{ role }` |
| DELETE | `/api/v1/organizations/:orgId/members/:userId` | admin, or yourself to leave | |
| POST | `/api/v1/organizations/:orgId/invitations` | admin | `{ email, role: admin\|member\|viewer }` |
| GET | `/api/v1/organizations/:orgId/invitations` | admin | |
| DELETE | `/api/v1/organizations/:orgId/invitations/:invitationId` | admin | |
| POST | `/api/v1/invitations/accept` | invited, verified user | `{ token }` |
