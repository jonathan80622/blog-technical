# VC collection test scope and real-world complexity

**Document ID:** `TEST-VC-REALITY-001`  
**Status:** current test truth; this document distinguishes implemented checks from unimplemented E2E coverage

## Correction: the current GitHub Action is not E2E

The manual GitHub Action named **VC queue delivery smoke test** is deliberately
narrow. Its script is [`scripts/smoke-vc-dispatch.mjs`](../scripts/smoke-vc-dispatch.mjs).
It does only this:

1. `POST /api/vc-discovery/dispatch` with `{ "limit": 1 }`.
2. Read the exact `jobIds[0]` returned by that response.
3. Poll `GET /api/vc-discovery` for that job.
4. Pass if that job has `attempts >= 1` and reaches `RUNNING`, `SUCCEEDED`, or
   `FAILED` within 120 seconds.

That verifies these production-like boundaries:

| Proven by the smoke test | Concrete assertion |
| --- | --- |
| Browser/API request reaches deployed dispatcher | `POST` returns `202`, `state: "QUEUED"`, and one job ID. |
| Queue producer accepts the message | The dispatcher returned a queued result rather than a publication failure. |
| Vercel trigger and consumer route match the topic | The same job is claimed by the callback. |
| Callback can create a workflow | `Job.attempts` increments in `claimVcDiscoveryJob()`. |
| Database state is observable from the deployed monitor endpoint | Polling finds the returned job ID and its durable state. |

It **does not prove** any of the following:

| Not proven by the smoke test | Why it can still fail after smoke passes |
| --- | --- |
| Official-site discovery | The workflow can fail in `findPortfolio`, as the five real jobs did. |
| Raw Responses parser | The consumer can start and then misread a valid OpenAI response. |
| Web-search result quality | Search may find an unofficial domain, no portfolio page, or an ambiguous entity. |
| Official-domain validation | `findPortfolio()` can reject a cross-domain portfolio URL. |
| Page fetch and assessment | HTTP responses can be short, blocked, redirected, login-gated, or non-HTML. |
| JavaScript-heavy/anti-bot sites | The current Coatue failure explicitly says browser rendering is required. The smoke test does not render pages. |
| Portfolio extraction | The model can return no candidate, an invalid passage, or a URL absent from stored page links. |
| Promotion policy | Candidate identity/domain/passage validation can reject every extracted item. |
| Company enrichment | Official-site, funding, technical-source, round, person, affiliation, and contribution workflows are downstream of the smoke assertion. |
| Evidence/coverage persistence | The smoke test does not inspect `DocumentVersion`, `Claim`, `ClaimEvidence`, `FundingRound`, `CoverageCheck`, `Person`, or `Contribution`. |
| Retry/dead-letter correctness | It only waits for one claim and accepts `FAILED`; it does not force duplicate delivery, step retry, or bounded terminal handling. |
| Resource behavior | It does not simulate five concurrent workflows, the 289-job backlog, rate limits, Vercel duration limits, database connection pressure, or OpenAI spend. |

Therefore “queue smoke passes” means only **the queue handoff works**. It must
never be reported as “VC research works” or “E2E passes.”

## Real-world stages and their failure surfaces

The actual path for one VC is:

```text
prepared Job
  → dispatcher lease
  → Vercel Queue publish
  → private callback / workflow start
  → OpenAI web search and structured response
  → official-domain validation
  → fetch/assess portfolio page
  → store DocumentVersion + links
  → extract exact-passage candidates
  → validate identity/domain/link/passage
  → create reviewed claims/portfolio links
  → discover/fetch/extract company funding + technical sources
  → update coverage and finish Job
```

Each arrow represents a separate external or durable-state contract. The
failures already observed demonstrate why a queue-only check is insufficient:

| Observed result | Stage | Mechanism |
| --- | --- | --- |
| `PENDING`, zero attempts, queue publication failed | publish | Invalid Vercel topic contained a period. |
| `FAILED`, one attempt, no text | OpenAI response parse | Raw HTTP JSON was parsed as an SDK convenience object. |
| `FAILED`, one/two attempts, `insufficient_content` | source assessment | The page returned too little usable source text. |
| `FAILED`, one/two attempts, browser rendering required | source assessment | Static fetch cannot extract a JavaScript-rendered page. |

The last two are not test artifacts. They are normal source-adapter outcomes
that require explicit capability routing, a renderer, or a bounded unresolved
coverage result; repeating the same static-fetch step three times does not make
a JavaScript-rendered page become static HTML.

## What a genuine E2E test must be

A real E2E test must run in an isolated deployment and database. It must not
use the production market-map backlog. It needs all of these preconditions:

1. A Vercel preview deployment with a preview-only `DATABASE_URL` and
   `OPENAI_API_KEY`; it must not point to production data.
2. A test fixture investor with a stable, manually verified official portfolio
   page that is known to be statically fetchable. Dynamic sites such as the
   current Coatue case are renderer-adapter tests, not the baseline fixture.
3. A unique test job/deduplication key, so the test can inspect exactly one
   workload without competing with the market-map batch.
4. An authenticated test-status interface or direct preview database access so
   the test can assert exact records, not infer them from the truncated
   eight-row monitor endpoint.
5. A cleanup policy for the fixture job, sources, documents, claims, coverage,
   and model/search spend.

The assertions must be terminal and evidence-specific:

```text
Job is SUCCEEDED
AND attempts >= 1
AND a Source exists for the fixture portfolio URL
AND a DocumentVersion has body + links
AND at least one Claim has exact evidence passage from that DocumentVersion
AND a PortfolioRelationship is present only if the promotion policy accepted it
AND CoverageCheck records the actual task outcome
```

For sources intentionally expected to be unresolved, a separate E2E fixture
must assert `SEARCHED_UNRESOLVED` with an attempt record—not `SUCCEEDED` and not
an invented negative fact.

## Test layers required before completion claims

| Layer | Test artifact | Required outcome | Current state |
| --- | --- | --- | --- |
| Wire parser unit | `tests/responses-output.test.ts` | Nested raw Responses text, top-level fallback, incomplete diagnostics | Implemented and passing |
| Queue handoff smoke | `scripts/smoke-vc-dispatch.mjs` + manual GitHub Action | One dispatched job is claimed by consumer | Implemented; must be run against preview after deployment |
| Provider contract integration | OpenAI test using a captured/live response | Structured-output response parses against schema | Not yet implemented as a separate CI test |
| Source adapter integration | Static fixture and JS-rendered fixture | Static fetch succeeds; JS page routes to renderer/unresolved policy | Not implemented |
| Workflow E2E | Isolated Vercel preview + isolated DB + fixed investor fixture | Terminal job plus exact evidence/coverage assertions | Not implemented |
| Load/retry test | Controlled five-job batch and duplicate delivery/failure injection | Capacity, idempotency, retry, and cost behavior | Not implemented |

## Operational rule

Use these labels precisely:

- **Unit-tested**: parser/function fixture passed.
- **Queue-smoke-tested**: publish and callback claim passed.
- **Workflow-E2E-tested**: isolated fixture reached the stated durable evidence
  assertions.
- **Production-observed**: real source completed with inspectable evidence.

No weaker label may be substituted for a stronger one.
