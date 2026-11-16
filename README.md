# UptimeWatch

Multi-tenant uptime monitoring for websites and APIs: scheduled HTTP checks, confirmed-failure
incident detection, email alerts, availability analytics and public status pages.

> **Status: Phase 0 of 8 — foundations.** The monorepo, tooling, local infrastructure and CI are
> in place. Product features land phase by phase; see the roadmap below.

## Architecture

A modular monolith (Next.js) plus independent asynchronous workers. PostgreSQL is the source of
truth; Redis/BullMQ carries jobs; a transactional outbox links the two so no event is lost.

```
apps/web        Next.js 16 — UI, REST API, health endpoints
apps/worker     Scheduler, outbox dispatcher, check + notification workers (Phase 3+)
packages/config Validated environment (Zod)
packages/db     Drizzle ORM schema, migrations, client
packages/queue  Redis connections (BullMQ in Phase 3)
docs/           Architecture notes and decision records
```

Details: [docs/architecture.md](docs/architecture.md) · decisions: [docs/decisions](docs/decisions).

## Run locally

Requirements: Node.js 22, pnpm 10, Docker.

```bash
cp .env.example .env
pnpm install
pnpm infra:up        # PostgreSQL 17 + Redis 7
pnpm dev             # web on http://localhost:3000 + worker
```

Check it works:

```bash
curl localhost:3000/health/live    # {"status":"ok"}
curl localhost:3000/health/ready   # 200 when PostgreSQL and Redis are reachable, else 503
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run web and worker in watch mode |
| `pnpm build` | Production build of every package |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates (also run in CI) |
| `pnpm db:generate` / `pnpm db:migrate` | Generate and apply Drizzle migrations |

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, tooling, Docker, CI | Done |
| 1 | Authentication and multi-tenancy | Next |
| 2 | Monitor management | — |
| 3 | Scheduler, outbox, queues | — |
| 4 | HTTP check engine with SSRF protection | — |
| 5 | Incidents and email notifications | — |
| 6 | Dashboard and analytics | — |
| 7 | Public status pages | — |
| 8 | Hardening, load tests, deployment | — |

## License

MIT
