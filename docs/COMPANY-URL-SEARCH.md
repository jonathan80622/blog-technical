# Company website search

This is an independent baseline: **Investor → one OpenAI web-search request → saved company website URLs**. Open it from **Investors → Find company websites**, or at `/company-urls`. Select an existing investor and run a search for up to 30 companies. Each result shows the company's website and supporting source links where supplied. Results are search findings and can be incomplete or outdated; they are not automatically accepted investment claims.

## Boundary

- UI: `app/company-urls/page.tsx` and `features/company-url-search/CompanyUrlSearch.tsx`.
- API: `GET/POST /api/company-url-search`.
- Search, parsing and orchestration: `features/company-url-search/core.ts`.
- Persistence: `features/company-url-search/repository.ts` and the dedicated `CompanyUrlSearch` table.
- Only shared dependencies: the Prisma connection and read access to existing Investor identities. No foreign keys attach search history to the existing pipeline.

No company page is fetched. There are no collection, renderer, assessment, embedding, workflow or queue calls, and no writes to Company, Source, Claim, PortfolioRelationship, CoverageCheck or Job. Existing collection buttons and APIs retain their original behavior. The existing `/api/overview` is not involved in loading or saving these results.

## Persistence and failures

A search record is created before the provider call. The complete JSON response (including returned citation annotations and consulted-source metadata), selected model and provider response ID are retained. Validated company links, their count, and SAVED/EMPTY state are committed in one row update. The POST returns that stored record only after database persistence succeeds. SAVED requires at least one link; an empty completed search is EMPTY; malformed/incomplete output and provider failures are FAILED. Invalid company URLs are omitted with a count; if every returned entry is invalid, the search fails rather than reporting a legitimate empty result. Supporting links are not required, and exact local snapshots are not a prerequisite.

Company website links are normalized and deduplicated by hostname (including www variants). Non-HTTP links, credential-bearing URLs and links on the known investor's own domain are excluded. This is link hygiene, not independent proof of the company's identity or investment relationship. Search does not promise a complete portfolio or current URL reachability.

One API request has a 120-second provider deadline and a 150-second persistence deadline. The route allows 180 seconds. An interrupted SEARCHING record is changed to FAILED on a later history read after its deadline; late completions cannot overwrite it. There are no automatic paid retries. Search history polls independently and survives reloads, including failed and empty attempts. The newest 20 searches for the selected investor are displayed; previous database records are retained.

## Setup

Apply `prisma migrate deploy` to add migration `0009_company_url_search`, regenerate Prisma Client, and configure `OPENAI_API_KEY`. Optional `OPENAI_COMPANY_URL_MODEL` defaults to `gpt-5.5`; blank values also use the default. No new npm dependency or queue configuration is required.

## Removal

To remove this path, remove `features/company-url-search`, `app/company-urls`, `app/api/company-url-search`, its tests, `.github/workflows/company-url-search.yml` and this document, plus the **Find company websites** link in the Investors component and the optional environment variable. Retain already-applied migration history; add a new migration to drop `CompanyUrlSearch` and remove its Prisma model when its saved history can be discarded. No cleanup of existing collection/domain tables is needed.

Conversely, the legacy collection/enrichment/indexing modules can be removed without changes to this feature, provided the shared Investor identities and database connection remain available.

## Validation

`pnpm test` includes request-contract and persistence-failure tests with controlled dependencies. The separate **Company URL search persistence** workflow applies migrations to disposable PostgreSQL and checks real row persistence, database constraints, expired attempts and protection against late failure callbacks. Neither invokes live OpenAI or production Postgres. A deployed acceptance check must run one search, reload its persisted history and inspect company URLs and supporting links. No live research run or production database migration is triggered by these tests.
