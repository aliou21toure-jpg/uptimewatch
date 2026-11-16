# 0008 — Availability, latency and coverage analytics

**Status:** accepted · 2026-11-16

## Definitions
| Metric | Formula | Notes |
|---|---|---|
| Uptime | `up / (up + down)` | Platform errors (`error`) and `skipped` checks are excluded (spec §2.6) |
| Coverage | `(up + down) / (up + down + error + skipped + missed slots)` | Shows when the platform itself failed to observe the service |
| Response time | avg, P50, P95 over **successful** checks | Timeouts and errors would otherwise pose as slow responses |
| Downtime | sum of incident time inside the window | Ongoing incidents count up to "now" |

Missed slots are recorded by the scheduler on the check that replaces them (`missed_slots`), so an
outage of the platform lowers coverage instead of silently disappearing from the statistics.

## Where the numbers come from
- **24 hours**: computed from raw checks — exact P50/P95 (`percentile_cont`), partition-pruned.
- **7 / 30 days**: past days from `monitor_daily_stats`, **today computed live** from raw checks,
  so the three windows on one screen always agree. Average latency is weighted by check count.
  Percentiles are not averaged across days (that would be wrong); daily P95 is kept per day instead.
- `monitor_daily_stats` is rebuilt by the worker (today and yesterday every 5 minutes, the last
  30 days at start-up) with an idempotent upsert, and kept 13 months; raw checks are kept 30 days.

## Charts
Response time uses the validated categorical slots 1–2 of the dark palette (P50 blue `#3987e5`,
P95 orange `#d95926`; CVD ΔE 26.8 against the app surface), 2 px lines, a legend, and a crosshair
tooltip listing both series; buckets are 10 minutes and empty buckets stay empty (no interpolation).
Daily uptime is a status strip whose colors always come with a named level (Operational, Minor
issues, Degraded, Major outage, No data), a focusable per-day tooltip and a legend.
