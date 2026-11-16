# 0002 — Amendments to specification v1.0

**Status:** accepted · 2026-11-15

Review of the v1.0 specification found inconsistencies. The implementation follows these fixes.

| # | Issue in v1.0 | Decision |
|---|---|---|
| 1 | `RECOVERING` appears in the incident lifecycle but not in monitor states or the `monitor_state` enum | Add `recovering` to the enum: monitor is `DOWN`, first success moves it to `RECOVERING`, second consecutive success to `HEALTHY` |
| 2 | Incident fields listed in §2.4 (detection date, detected cause, failed-check count) are absent from the `incidents` table | Add `detected_at`, `cause_code`, `failed_check_count`. `opened_at` is the time of the first failed check, `detected_at` the time of confirmation |
| 3 | `HEAD` requests have no body, so `body_contains` cannot be checked | `CHECK (method = 'GET' OR body_contains IS NULL)` plus the same rule in Zod validation |
| 4 | `incident_updates` and `notification_deliveries` reference `incidents(id)` only; `incident_updates.org_id` has no foreign key | `UNIQUE (org_id, id)` on `incidents` and composite foreign keys `(org_id, incident_id)` on both tables |
| 5 | Status page URL shown as `/status/<organization>` although an organization can have several pages | URL is `/status/<page-slug>`; the slug is unique per page |
| 6 | `monitor_checks` grows by about 1.4M rows/day at target load with 30-day retention | Range-partition by day on `scheduled_for`; retention drops whole partitions |
| 7 | Estimate table says 25–38 days; the phase estimates sum to 29–44 | Use 29–44 days |

## Tooling notes
- TypeScript is pinned to 6.0.x: typescript-eslint does not yet support TypeScript 7.
