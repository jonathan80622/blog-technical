# VC Intelligence

Evidence-first research for a selected VC universe. The application keeps portfolio membership, funding-round participation, source documents, claims, and coverage checks as distinct records.

## Local setup

1. Connect Prisma Postgres through the Vercel integration and enable the `vector` extension.
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL` and OpenAI credentials.
3. Run `npx pnpm@11 exec prisma migrate deploy`, then `npx pnpm@11 run db:seed`.
4. Run `npx pnpm@11 run dev`.

The seed creates only the two selected investor records and their configured portfolio sources. It intentionally does **not** invent ten companies or funding facts; collection and review promote those from evidence.

## Collection contract

`POST /api/research` creates a durable `ResearchRun`, `SourceRun`, and initial event, then returns `202`. A Vercel Workflow runs collection in durable steps; the Collection screen polls the stored source-event timeline.

## Hosting boundary

Vercel and Prisma Postgres are the active application control plane. The legacy AWS renderer scaffold is not part of the deployed collection path.

## Enqueue the October 2026 market-map batch

`.github/workflows/enqueue-market-map.yml` is manually dispatched from GitHub Actions; a push never runs it. Add the direct Production Prisma Postgres connection string as the GitHub environment secret `DATABASE_URL` in the `production` environment. Then run **Enqueue market-map source fetches** and enter `ENQUEUE_2026_10_17`. The action calls the idempotent batch script and prints only created/already-queued counts.
