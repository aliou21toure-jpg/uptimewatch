# UptimeWatch

Multi-tenant uptime monitoring for websites and APIs: scheduled HTTP checks, confirmed-failure
incident detection, email alerts, availability analytics and public status pages.

> **Status: Phase 1 of 8 — accounts and organizations.** Sign-up with email verification, password
> reset, organizations, roles and invitations work end to end. Monitoring lands in the next phases.

## Architecture

A modular monolith (Next.js) plus independent asynchronous workers. PostgreSQL is the source of
truth; Redis/BullMQ carries jobs; a transactional outbox links the two so no event is lost.

```
apps/web         Next.js 16 — UI, REST API (/api/v1), auth (/api/auth), health endpoints
apps/worker      Scheduler, outbox dispatcher, check + notification workers (Phase 3+)
packages/domain  Business rules: tenant gate, roles, organizations, invitations
packages/db      Drizzle ORM schema, SQL migrations, client
packages/email   Email transport (Resend, or console in development)
packages/config  Validated environment (Zod)
packages/queue   Redis connections (BullMQ in Phase 3)
docs/           Architecture notes and decision records
```

Details: [architecture](docs/architecture.md) · [REST API](docs/api.md) · [decisions](docs/decisions).

## Run locally

Requirements: Node.js 22, pnpm 10, Docker.

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET in .env, e.g. with: openssl rand -base64 32
pnpm install
pnpm infra:up        # PostgreSQL 17 + Redis 7
pnpm db:migrate      # create the tables
pnpm dev             # web on http://localhost:3000 + worker
```

Open http://localhost:3000/register. In development, emails (verification, password reset,
invitations) are printed in the terminal running `pnpm dev`: open the link from there.

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

Integration tests start a throwaway PostgreSQL with Testcontainers (Docker required). To reuse a
local database instead: `TEST_DATABASE_URL=postgres://... pnpm test`.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, tooling, Docker, CI | Done |
| 1 | Authentication and multi-tenancy | Done |
| 2 | Monitor management | Next |
| 3 | Scheduler, outbox, queues | — |
| 4 | HTTP check engine with SSRF protection | — |
| 5 | Incidents and email notifications | — |
| 6 | Dashboard and analytics | — |
| 7 | Public status pages | — |
| 8 | Hardening, load tests, deployment | — |

## License

MIT
