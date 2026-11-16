# 0005 — Scheduling, outbox and at-most-once execution

**Status:** accepted · 2026-11-16

## Pipeline
```
scheduler (every 2 s) ──► monitor_checks (queued) + outbox_events     ← one transaction
outbox dispatcher (every 500 ms) ──► BullMQ "checks" (job id = check-<id>-<attempt>)
check worker ──► reserve (queued → running, lease) ──► execute ──► record (fenced)
recovery (every 30 s) ──► expired leases / never-picked checks back through the outbox
maintenance (hourly) ──► daily partitions ahead, drop past 30 days, purge old outbox rows
```

## Guarantees and how they are obtained
| Guarantee | Mechanism |
|---|---|
| Concurrent schedulers never plan the same slot twice | `FOR UPDATE SKIP LOCKED` on due monitors **and** `UNIQUE (monitor_id, scheduled_for)` |
| A planned check is never lost between PostgreSQL and Redis | Check row and outbox event written in the same transaction |
| Re-publishing an event does not duplicate the job | Deterministic BullMQ job id per (check, attempt); completed ids kept for 1 h |
| A slot executes at most once at a time | Reservation is an atomic `UPDATE … WHERE state = 'queued'`; duplicate deliveries return "duplicate" |
| A superseded worker cannot overwrite a newer result | Completion is fenced on `attempts` (the reservation's attempt number) |
| A crashed worker does not block a slot | 60 s lease; recovery re-queues expired leases, up to 3 attempts |
| Platform failures are not reported as site outages | Lease exhaustion → `error/LEASE_EXPIRED`; executor crash → `error/ENGINE_ERROR`; both excluded from uptime |
| No burst after downtime | A slot more than one interval late is replaced by `now`; checks older than 10 min are `skipped/STALE` |

Delivery is **at-least-once** end to end; idempotent reservation turns it into at-most-once execution per attempt.

## Partitioning
`monitor_checks` is range-partitioned by UTC day on `scheduled_for` (`monitor_checks_pYYYYMMDD`).
Keys include the partition key (`PRIMARY KEY (id, scheduled_for)`), and jobs carry `scheduledFor`
so every lookup is pruned to one partition. Partitions are created 7 days ahead; retention is
`DROP TABLE` on partitions older than 30 days instead of a large `DELETE`.

## Scaling
Every role is safe to run in several worker replicas at once. At the v1 target (1,000 monitors at
60 s ≈ 17 checks/s) a single worker with concurrency 20 is sufficient; add replicas for more.
