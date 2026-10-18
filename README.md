# VC Intelligence

Evidence-first research for a selected VC universe. The application keeps portfolio membership, funding-round participation, source documents, claims, and coverage checks as distinct records.

The UI component/backend document-ID index is in
[\`UI-COMPONENT-INDEX\`](docs/UI-COMPONENT-INDEX.md).

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

`.github/workflows/enqueue-market-map.yml` is manually dispatched from GitHub Actions; a push never runs it. Add the direct Production Prisma Postgres connection string as the GitHub environment secret `DATABASE_URL` in the `production` environment. Then run **Enqueue market-map source fetches**. The action calls the idempotent batch script and prints only created/already-queued counts. In Vercel runtime environments, `DATABASE_URL` must instead use the `pooled.db.prisma.io` value; direct `db.prisma.io` URLs are for migrations/admin tooling only.

## Hobby-safe VC discovery

After the market-map action has created pending jobs, the Collection screen's **Dispatch next 5 prepared VCs** control requests up to five jobs from the Vercel Queue; **Dispatch 1 prepared VC** is the smaller fallback. Its private queue consumer starts a durable workflow that uses OpenAI web search to locate an investor's official portfolio page, fetches and indexes that page, then promotes only extracted company entries whose exact supporting passage exists in the stored source document. The dispatcher keeps Prisma as the durable backlog. It permits five active discoveries only with a pooled Prisma runtime URL; a direct or unknown URL is deliberately limited to one. It does not use Vercel Cron.

Vercel Queue itself needs no application secret. The deployed app still needs `DATABASE_URL` and `OPENAI_API_KEY`; `OPENAI_DISCOVERY_MODEL` and `OPENAI_EXTRACTION_MODEL` are optional and default to `gpt-5.5`.
# Documentation

The UI-to-backend state contract and its document-ID index are in
[`DOC-UI-PROGRESS-001`](docs/UI-BACKEND-PROGRESS-CONTRACT.md).
