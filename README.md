# VC Intelligence

An evidence-first personal VC research pilot. The UI ships with fixture data so its critical semantics can be reviewed before credentials or live collection are provisioned.

## Run

1. `pnpm install`
2. Copy `.env.example` to `.env` and add a development PostgreSQL URL.
3. `pnpm prisma generate && pnpm prisma migrate deploy`
4. `pnpm dev`

## What is implemented

- Browseable Investors, Companies, Coverage, Sources, Research runs, and Chat views.
- Evidence inspector that separates funding participation from portfolio membership and exposes uncertainty.
- A Prisma 6 data model for facts, evidence, coverage, documents, jobs, attempts, and transactional outbox delivery.
- Explicit pgvector migration (1536 dimensions; choose and version the actual embedding model before production import).

The visual fixture is intentional: it never calls live search or claims that an empty result proves absence. Configure database, source adapters, object storage, queue, worker, and model credentials before enabling collection.
