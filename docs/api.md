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

## Monitors
| Method | Path | Permission | Body / query |
|---|---|---|---|
| POST | `/api/v1/organizations/:orgId/monitors` | member | `{ name, url, method?, intervalSeconds?, timeoutMs?, expectedStatusMin?, expectedStatusMax?, bodyContains?, headers?: [{ name, value }] }` |
| GET | `/api/v1/organizations/:orgId/monitors` | viewer | `?q=&state=&limit=1..100&cursor=` → `{ data, nextCursor }` |
| GET | `/api/v1/organizations/:orgId/monitors/:monitorId` | viewer | |
| PATCH | `/api/v1/organizations/:orgId/monitors/:monitorId` | member | any subset of the create fields; `headers` replaces all |
| DELETE | `/api/v1/organizations/:orgId/monitors/:monitorId` | member | |
| POST | `/api/v1/organizations/:orgId/monitors/:monitorId/pause` | member | |
| POST | `/api/v1/organizations/:orgId/monitors/:monitorId/resume` | member | |

Defaults: `GET`, every 60 s, 10 s timeout, status 200–299. Intervals: 30, 60, 300, 600, 900, 1800, 3600 s.
Header values are write-only: responses include `headerNames` only.

| GET | `/api/v1/organizations/:orgId/monitors/:monitorId/checks` | viewer | `?from=&to=&state=&limit=1..500&cursor=` (default: last 24 h, max range 31 days) |

## Incidents
| Method | Path | Permission | Body / query |
|---|---|---|---|
| GET | `/api/v1/organizations/:orgId/incidents` | viewer | `?status=open\|acknowledged\|resolved\|active&monitorId=&limit=&cursor=` |
| GET | `/api/v1/organizations/:orgId/incidents/:incidentId` | viewer | incident + timeline + notification deliveries |
| POST | `/api/v1/organizations/:orgId/incidents/:incidentId/acknowledge` | member | |
| POST | `/api/v1/organizations/:orgId/incidents/:incidentId/updates` | member | `{ status: investigating\|identified\|monitoring, message }` |

## Notification preferences (the signed-in user's own)
| Method | Path | Body |
|---|---|---|
| GET | `/api/v1/organizations/:orgId/notification-preferences` | |
| PATCH | `/api/v1/organizations/:orgId/notification-preferences` | `{ enabled?, incidentOpened?, incidentResolved? }` |

## Analytics
| Method | Path | Permission | Returns |
|---|---|---|---|
| GET | `/api/v1/organizations/:orgId/dashboard` | viewer | windows (24h/7d/30d), 30-day daily series, per-monitor uptime and latency, latest events |
| GET | `/api/v1/organizations/:orgId/monitors/:monitorId/stats` | viewer | windows, 10-minute latency series (24 h), 30-day daily series |

## Status pages
| Method | Path | Permission | Body |
|---|---|---|---|
| POST | `/api/v1/organizations/:orgId/status-pages` | admin | `{ title, slug, description?, isPublic? }` |
| GET | `/api/v1/organizations/:orgId/status-pages` | viewer | |
| GET | `/api/v1/organizations/:orgId/status-pages/:pageId` | viewer | |
| PATCH | `/api/v1/organizations/:orgId/status-pages/:pageId` | admin | any subset of the create fields |
| DELETE | `/api/v1/organizations/:orgId/status-pages/:pageId` | admin | |
| PUT | `/api/v1/organizations/:orgId/status-pages/:pageId/components` | admin | `[{ monitorId, displayName? }]` in display order |

## Public (no authentication)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/status/:slug` | Public projection only; cached 30 s; CORS `*`; 404 for private or unknown pages |
| GET | `/status/:slug` | HTML status page |
