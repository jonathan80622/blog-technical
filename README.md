# Startup AI investment evidence

Evidence-first research into AI technologies startups are investing engineering effort in. Investor portfolios are a heuristic for finding startup candidates, not proof of high growth or AI investment. The workflow collects technical writing and hiring evidence, extracts reviewable AI signals, and compares accepted signals across distinct companies. Hiring demand and demonstrated technical use remain separate measures.

The UI component/backend document-ID index is in
[`UI-COMPONENT-INDEX`](docs/UI-COMPONENT-INDEX.md).

## Local setup

1. Connect Prisma Postgres through the Vercel integration and enable the `vector` extension.
2. Copy `.env.example` to `.env.local`; set `APP_EXECUTION_MODE=local`, `DATABASE_URL`, and OpenAI credentials.
3. Run `npx pnpm@11 exec prisma migrate deploy`, then `npx pnpm@11 run db:seed`.
4. Run `npx pnpm@11 run dev`.

## Execution profiles

`APP_EXECUTION_MODE` is the profile switch. Use `local` for development: source
collection starts through the Workflow SDK, while VC discovery claims its
database job and starts that same workflow directly. This path does not require
Vercel Queue credentials. Use `hosted` for deployed application behavior:
Vercel handles HTTP requests, durable workflows, and VC Queue delivery. GitHub
Actions handles verification, production migrations, and the explicitly
dispatched market-map enqueue; it is not an application runtime. Vercel is
detected automatically when the variable is unset. Production builds outside
Vercel must set the profile explicitly. GitHub verification selects `local`
and runs unit/API tests, a production build, and database-backed Playwright
journeys.

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
The workflow scenarios in Gherkin are in
[`ai-investment.feature`](docs/ai-investment.feature).

## Local verification

From this directory, install dependencies and generate the Prisma client:

```sh
npx pnpm@11 install
npx pnpm@11 exec prisma generate
npx pnpm@11 exec playwright install chromium
```

Then run the backend contract tests, production build, and browser suite:

```sh
npm test
npm run build
npx playwright install chromium
E2E_DATABASE_URL='postgresql://…/vc_intelligence_e2e' npm run test:e2e
```

The Playwright suite requires `E2E_DATABASE_URL`: a disposable PostgreSQL
database whose name ends in `_e2e`. It applies migrations, clears the database
between scenarios, seeds only the evidence required by the scenario, and drives
the browser through the real Next API handlers. Queue delivery and durable
workflow execution remain integration concerns; the E2E suite covers their
persisted handoff and monitoring contract instead of faking responses in the
browser.

## Runtime test audit

Run `npm test`. It discovers every `*.test.ts` and `*.spec.ts` below `tests/`
at run time, then opens a separate **Live test execution** window at
`http://127.0.0.1:4319`. The main product UI is not involved. The window
streams each discovered test file and test result as it runs; use
`npm run audit:all` to include browser specs. See
[`BEHAVIOR-TRACEABILITY.md`](docs/BEHAVIOR-TRACEABILITY.md).
