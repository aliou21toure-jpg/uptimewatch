# 0001 — Modular monolith with independent workers

**Status:** accepted · 2026-11-15

## Context
The product needs a web UI/API and background processing (scheduling, HTTP checks, emails).
It is built by one developer and targets 1,000 active monitors in v1.

## Decision
One Next.js application for UI and API, one separate worker process for all background work,
in a pnpm + Turborepo monorepo. Shared code lives in `packages/*` and ships as TypeScript
source (compiled by Next.js for the web app, bundled by tsup for the worker).

## Consequences
- Simple to run and deploy (two processes, PostgreSQL, Redis) while keeping web and workers independently scalable.
- Module boundaries are enforced by package boundaries, so a later split into services needs no rewrite.
- The demo needs a host that runs long-lived processes; serverless-only platforms cannot run the worker.
