# VC collection test scope and real-world complexity

**Document ID:** `TEST-VC-REALITY-001`  
**Status:** current test truth; this document distinguishes local fixture/browser coverage from unimplemented live integration coverage

## Current truth: no live-deployment test exists

The repository has no GitHub Action that dispatches a VC job, calls OpenAI, or
targets a deployed URL. The previous manual URL-based “smoke test” was removed:
the repository has no separate non-production deployment to target, and asking
for one was an invented operational requirement.

Local verification now runs the Node contract tests, TypeScript checking, a
Next.js production build, and Playwright browser tests with mocked API routes.
These checks prove fixture-backed API/UI behavior, not a deployed queue
handoff. They **do not prove**:

| Not proven by repository verification | Why it can still fail after checks pass |
| --- | --- |
| UI behavior against live API handlers | Playwright stubs API responses to check button requests and visible states. It does not execute route handlers or durable database mutations. |
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

## URL-equivalence regression fixtures

The portfolio-discovery workflow must distinguish URL normalization from an
assertion that two independently discovered sites are the same official site.
The following fixtures define that boundary. “Verify” means retain both URLs
and establish the relationship through a redirect, fetched content, or an
explicit canonical declaration; normalization alone must not treat a different
registrable domain as trusted.

| Regression fixture | Example | Source | Recommendation |
| --- | --- | --- | --- |
| `www` / apex | `www.example.com` vs `example.com` | MDN | Accept as a likely site match, subject to verification. |
| Host capitalization | `EXAMPLE.com` vs `example.com` | RFC 3986 | Normalize automatically. |
| Default HTTPS port | `example.com:443` vs `example.com` | RFC 3986 | Normalize automatically. |
| Empty vs `/` path | `example.com` vs `example.com/` | RFC 3986 | Normalize automatically. |
| Percent-encoded unreserved characters | `/port%66olio` vs `/portfolio` | RFC 3986 | Normalize automatically. |
| Dot segments | `/about/../portfolio` vs `/portfolio` | RFC 3986 | Normalize automatically. |
| HTTP / HTTPS | `http://example.com` vs `https://example.com` | Google | Verify redirect or content equivalence. |
| Domain migration | `oldfirm.com` → `newfirm.com` | Google | Record a verified redirect relationship. |
| Canonical tag | Page declares another URL as canonical | Google | Use as supporting evidence. |
| Filtered pages | `/portfolio?sector=AI` vs `/portfolio` | Google | Recognize the relationship but preserve filter semantics. |
| Mobile website | `m.example.com` vs `example.com` | Google | Verify canonical relationship. |

The current `findPortfolio()` failure is covered by the first row when the
model supplies an apex portfolio URL and a `www` homepage (or the reverse).
This is a bug-reproduction fixture: it is not evidence that a prior version
worked, but a fixed input that must pass once the intended normalization policy
is implemented.

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
| Backend/API contracts | `tests/backend-api.test.ts`, `tests/vc-discovery-api.test.ts`, `tests/safe-source-fetch.test.ts` | Input validation, process ordering, safe errors, AI acceptance evidence, queue compensation/tracking failures, public-address validation, redirect policy, and distinct trend counts | Implemented and passing locally |
| Browser UI contract | `tests/e2e/control-to-api.spec.ts` | Every current UI action's request/result, visible state, source links, API errors, queue dispatch/replay, monitors, and phone-sized Collection | Implemented with mocked APIs; not backend proof |
| Queue handoff | User-observed deployed VC dispatch | Exact returned job is claimed by consumer | Not automated |
| Provider contract integration | OpenAI test using a captured/live response | Structured-output response parses against schema | Not yet implemented as a separate CI test |
| Source adapter integration | Static fixture and JS-rendered fixture | Static fetch succeeds; JS page routes to renderer/unresolved policy | Not implemented. Fetch safety policy is unit-tested with injected DNS/transport; no live source adapter test exists. |
| Workflow acceptance | Existing deployed application + a selected VC job | Terminal job plus exact evidence/coverage assertions | Not automated |
| Load/retry test | Controlled five-job batch and duplicate delivery/failure injection | Capacity, idempotency, retry, and cost behavior | Not implemented |

## Operational rule

Use these labels precisely:

- **Unit-tested**: parser/function fixture passed.
- **Deployed-observed**: a user-observed run reached the stated durable
  evidence assertions.
- **Production-observed**: real source completed with inspectable evidence.

No weaker label may be substituted for a stronger one.
