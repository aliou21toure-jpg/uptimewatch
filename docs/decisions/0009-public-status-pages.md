# 0009 — Public status pages

**Status:** accepted · 2026-11-16

## What is published (allow-list)
`getPublicStatusPage` builds the page from an explicit list of fields; anything not listed is never
read into the response:

| Shown | Never shown |
|---|---|
| Page title and description | Monitor URLs, methods, keywords, custom headers |
| Component name (public display name, or the monitor name) | Monitor, organization or user ids |
| Component status: operational / degraded / outage / not monitored / pending | Internal monitor names when a display name is set |
| Uptime over 90 days and per day | HTTP status details beyond incident messages |
| Incidents of the page's components (ongoing + resolved in the last 14 days) with their updates | Author names (acknowledgements no longer embed the member's name) |

Incident titles are rebuilt from the public component name. The editor and the incident update form
both state that updates on a listed monitor are published.

## Overall status
Components that are paused or not yet checked are ignored. All down → major outage; some down →
partial outage; any degraded/recovering → degraded; otherwise operational.

## Tenant safety
`status_page_monitors` references both `(org_id, status_page_id)` and `(org_id, monitor_id)`, so the
database refuses a page listing another organization's monitor. The service checks ownership first and
answers `NOT_FOUND` either way. Slugs are unique across organizations, validated, and some are reserved.

## Caching
- `/status/<slug>` is rendered on demand and cached for 30 s (ISR). Every edit (settings, components,
  deletion, making the page private) revalidates the old and new paths immediately.
- `/api/public/status/<slug>` returns the same projection with
  `Cache-Control: public, max-age=30, s-maxage=30, stale-while-revalidate=60` and
  `Access-Control-Allow-Origin: *` for embeds and badges.
- Private and unknown pages return 404. Members can preview any page, private or not, inside the app.
