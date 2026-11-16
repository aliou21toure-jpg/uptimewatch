# 0007 — Incidents and email notifications

**Status:** accepted · 2026-11-16

## Incident lifecycle
The incident engine runs **inside the transaction that records a check result**, with the monitor
row locked, right after the state machine (0006):

| Transition | Effect |
|---|---|
| `incident_opened` (2nd consecutive failure) | Insert incident (`opened_at` = first failure of the streak, `detected_at` = confirmation, cause from the check), system update "investigating", outbox event `incident.opened` |
| further failures while open | `failed_check_count + 1` |
| `incident_resolved` (2nd consecutive success) | Status `resolved`, `resolved_at`, system update, outbox event `incident.resolved` |
| monitor paused or its URL changed | Active incident closed with an explanatory update, **no** notification (the reset monitor could never resolve it itself) |

One active incident per monitor is guaranteed by a partial unique index
(`WHERE status IN ('open','acknowledged')`); the engine inserts with `ON CONFLICT DO NOTHING` so a
violation can never make a check fail. Members can acknowledge and post updates
(investigating / identified / monitoring); resolution is decided by the checks, never declared by hand.

Updates and deliveries reference incidents through `(org_id, incident_id)` composite foreign keys.

## Notifications: exactly one email per person and event
```
incident change ─(same tx)─► outbox ─► BullMQ "notifications" (job id per event)
   ─► fan-out: one notification_deliveries row per member who wants it   (UNIQUE incident+user+event)
   ─► send: claim with SKIP LOCKED ─► Resend with Idempotency-Key = delivery id ─► mark sent
   ─► sweep every 15 s: retries pending deliveries with exponential backoff (30 s … 1 h), 5 attempts → failed
```
- Duplicate jobs re-run the fan-out, which inserts nothing new.
- Concurrent sweeps cannot claim the same delivery.
- A crash after the provider accepted the email but before it was marked sent is absorbed by the
  provider-side idempotency key on the retry.
- Recipients: verified members of the organization, filtered by their per-organization preferences
  (all on by default; `enabled`, `incident_opened`, `incident_resolved`).

## Email configuration
The worker validates only the email variables (`APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`,
`EMAIL_TRANSPORT`), not the web's authentication secret.
