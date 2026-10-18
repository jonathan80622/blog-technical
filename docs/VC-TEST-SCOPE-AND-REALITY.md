# VC collection test scope and real-world complexity

**Document ID:** `TEST-VC-REALITY-001`  
**Status:** current test truth; this document distinguishes implemented checks from unimplemented E2E coverage

## Current truth: no live-deployment test exists

The repository has no GitHub Action that dispatches a VC job, calls OpenAI, or
targets a deployed URL. The previous manual URL-based “smoke test” was removed:
the repository has no separate non-production deployment to target, and asking
for one was an invented operational requirement.

`Repository verification` runs only `pnpm test` and `pnpm build`. It proves
source-level behavior, not a deployed queue handoff. It **does not prove**:

| Not proven by repository verification | Why it can still fail after checks pass |
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

Therefore “repository verification passes” means only **the checked source
behavior builds and its fixtures pass**. It must never be reported as “VC
research works” or “E2E passes.”

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

## Live acceptance evidence

The first live verification must be an explicit, user-observed run through the
existing deployed application. It must inspect terminal and evidence-specific
records, not merely a green action:

```text
Job is SUCCEEDED
AND attempts >= 1
AND a Source exists for the fixture portfolio URL
AND a DocumentVersion has body + links
AND at least one Claim has exact evidence passage from that DocumentVersion
AND a PortfolioRelationship is present only if the promotion policy accepted it
AND CoverageCheck records the actual task outcome
```

For a source that remains unresolved, the accepted terminal evidence is
`SEARCHED_UNRESOLVED` with an attempt record—not an invented negative fact.

## Test layers required before completion claims

| Layer | Test artifact | Required outcome | Current state |
| --- | --- | --- | --- |
| Wire parser unit | `tests/responses-output.test.ts` | Nested raw Responses text, top-level fallback, incomplete diagnostics | Implemented and passing |
| Queue handoff | User-observed deployed VC dispatch | Exact returned job is claimed by consumer | Not automated |
| Provider contract integration | OpenAI test using a captured/live response | Structured-output response parses against schema | Not yet implemented as a separate CI test |
| Source adapter integration | Static fixture and JS-rendered fixture | Static fetch succeeds; JS page routes to renderer/unresolved policy | Not implemented |
| Workflow acceptance | Existing deployed application + a selected VC job | Terminal job plus exact evidence/coverage assertions | Not automated |
| Load/retry test | Controlled five-job batch and duplicate delivery/failure injection | Capacity, idempotency, retry, and cost behavior | Not implemented |

## Operational rule

Use these labels precisely:

- **Unit-tested**: parser/function fixture passed.
- **Deployed-observed**: a user-observed run reached the stated durable
  evidence assertions.
- **Production-observed**: real source completed with inspectable evidence.

No weaker label may be substituted for a stronger one.
