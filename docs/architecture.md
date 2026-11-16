# Architecture

## Processes

| Process | Role | Scaling |
|---|---|---|
| `apps/web` | UI, REST API, health endpoints | Stateless, horizontal |
| `apps/worker` | Scheduler, outbox dispatcher, check workers, notification worker | Horizontal; safe to restart |

Checks never depend on a browser request: the scheduler finds due monitors in PostgreSQL,
writes the planned check and an outbox event in one transaction, a dispatcher publishes the
event to BullMQ, and workers execute the HTTP request and record the result.

## Data flow

```
web/API -> domain services -> PostgreSQL -> outbox -> Redis/BullMQ -> workers -> PostgreSQL
                                                                    -> Resend (email)
```

## Guarantees the design aims for

- **No lost events** — transactional outbox between PostgreSQL and Redis.
- **No duplicate checks** — `UNIQUE (monitor_id, scheduled_for)` and deterministic job ids.
- **Crash recovery** — each running check holds a lease (`lease_until`); expired leases are reclaimed.
- **Tenant isolation** — every business row carries `org_id`; composite foreign keys forbid cross-organization links.
- **SSRF safety** — destinations are validated at every request and after every redirect, with the connection pinned to the validated IP.

## Health endpoints

- `GET /health/live` — process is running.
- `GET /health/ready` — PostgreSQL and Redis are reachable (503 otherwise). Responses never expose connection details.
