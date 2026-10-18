# Incident report: VC queue first run was reported as complete but did not publish work

**Incident ID:** `INC-VCQ-2026-10-18-001`  
**Scope:** the first implementation and first user-triggered run of VC queue dispatch  
**Status:** root cause fixed in the working tree; not a statement that production has been deployed or re-run successfully

## What I claimed, and why that claim was false

I reported the work as complete because this command passed:

```sh
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/next build && git diff --check
```

That proved only these things:

1. TypeScript accepted the imports and types.
2. Next could bundle the route and UI.
3. The working-tree diff had no whitespace errors.

It did **not** call `send()` against Vercel Queue, invoke the deployed queue
consumer, or inspect the production outbox error. Treating a green build as a
completed queue integration was the central false inference.

The actual evidence from the first user run was the opposite: five jobs returned
to `PENDING`, with zero workflow attempts and a generic publication failure.
That was not a partial success. It was evidence that no message reached the
consumer.

## Exact failing path

This is the pre-fix control flow that can be reproduced with any prepared job:

1. The UI called `POST /api/vc-discovery/dispatch`.
2. `leaseVcDiscoveryJobs()` changed up to five `Job` records from `PENDING` to
   `QUEUED` before attempting publication.
3. The dispatcher called `send(VC_DISCOVERY_TOPIC, ...)`.
4. Vercel Queue rejected the topic name before the consumer route could run.
5. The catch block changed the job back to `PENDING`.
6. No consumer claim occurred, so `Job.attempts` remained `0`.

The original topic value was:

```ts
export const VC_DISCOVERY_TOPIC = "vc-discovery.requested";
```

Vercel Queue topic names are constrained to `^[A-Za-z0-9_-]+$`. The period in
`vc-discovery.requested` is invalid. This is why all of the following failed in
the same way: Thrive Capital, Insight Partners, General Atlantic, Tiger Global
Management, and Coatue Management. The topic was an invariant of the dispatcher,
not a property of any particular VC.

The corrected producer constant is
[`lib/vc-discovery.ts:5`](/Users/jonathan/Codeland/blog-technical/lib/vc-discovery.ts:5):

```ts
export const VC_DISCOVERY_TOPIC = "vc-discovery-requested";
```

The corrected consumer trigger has the same topic in
[`vercel.json:7`](/Users/jonathan/Codeland/blog-technical/vercel.json:7). Both
must match. Changing only one would produce a different failure mode: messages
could be accepted but no configured consumer would receive them.

## Why the screenshot had exactly those values

| Screenshot value | Mechanism that produced it | Why my interpretation was wrong |
| --- | --- | --- |
| Five named VCs say `PENDING` | The dispatcher leased the first five eligible jobs, then the catch path returned each to `PENDING`. See [`returnVcDiscoveryJobToPending`](/Users/jonathan/Codeland/blog-technical/lib/vc-discovery.ts:36). | I treated “the endpoint exists and code builds” as evidence of dispatch. The final durable state showed dispatch failed. |
| `0` attempts | `attempts` increments only in [`claimVcDiscoveryJob`](/Users/jonathan/Codeland/blog-technical/lib/vc-discovery.ts:13), after Vercel invokes the consumer. The rejected send never reached it. | The UI column called this simply “Attempts,” which made it look like publish attempts. It is actually **consumer/workflow claim attempts**. |
| `Queue publication failed` | The pre-fix catch path set `Job.progress` to that fixed string and wrote the actual error only to `Outbox.lastError`. The monitor did not query or display `lastError`. | I created an error record but made the visible progress field discard the diagnostic needed to act on it. |
| `289 pending`, `0 active` | The 289 jobs were prepared by the market-map batch. `active` counts only `QUEUED` and `RUNNING`; after the catch returned the first five to `PENDING`, active was correctly zero. See [`leaseVcDiscoveryJobs`](/Users/jonathan/Codeland/blog-technical/lib/vc-discovery.ts:25). | I previously discussed capacity as though it explained lack of progress. Capacity was not the blocker. Publication was. |

## Code-level failures

### 1. An externally validated identifier was invented instead of checked

The bad string was used in two separate places:

```ts
// lib/vc-discovery.ts, pre-fix
export const VC_DISCOVERY_TOPIC = "vc-discovery.requested";

// vercel.json, pre-fix
"topic": "vc-discovery.requested"
```

The matching strings looked internally consistent. Internal consistency is not
validity against the provider contract. The topic regex is only enforced by the
queue service; neither TypeScript nor `next build` exercises it.

**Wrong principle applied:** “if producer and consumer use the same string, the
integration is configured.”

**Required principle:** validate every provider-owned identifier against the
provider contract, preferably with an integration test that actually publishes
one message.

### 2. State was advanced before the external side effect, then made opaque on failure

The lease operation deliberately sets `state: "QUEUED"` before the remote call:

```ts
// lib/vc-discovery.ts:30-31
const jobs = await tx.job.findMany(/* PENDING or FAILED */);
await Promise.all(jobs.map(job => tx.job.update({
  where: { id: job.id },
  data: { state: "QUEUED", progress: "Queued for VC source discovery" }
})));
```

That is a defensible reservation pattern only if the subsequent outcome is
observable. The pre-fix failure path was effectively:

```ts
db.job.update({
  where: { id: jobId },
  data: { state: "PENDING", leaseUntil: null, progress: "Queue publication failed" }
});
db.outbox.updateMany({ data: { lastError: error } });
```

The durable state correctly became retryable, but the only state exposed by the
monitor was the generic `progress` string. The actionable provider error was in
`Outbox.lastError` and not included by `vcDiscoverySummary()`.

The current failure path now places a bounded actual error in `Job.progress`
and `Outbox.lastError` at
[`lib/vc-discovery.ts:36-40`](/Users/jonathan/Codeland/blog-technical/lib/vc-discovery.ts:36).

**Wrong principle applied:** “a generic progress label is enough if the detailed
error exists somewhere in the database.”

**Required principle:** any error that prevents the next state transition must
be in the read model used by the operator who is expected to retry it.

### 3. The UI swallowed the dispatch response on the initial implementation

The first client handler used this shape:

```ts
const j = await r.json();
setQueueMessage(r.ok ? successOrIdleMessage : j.error);
```

The failed dispatcher response instead had this shape:

```json
{
  "state": "FAILED",
  "jobIds": [],
  "requested": 5,
  "failures": ["provider error text"]
}
```

It had no `error` property. Therefore `j.error` was `undefined`, React rendered
an empty status paragraph, and the user saw a click that appeared to do nothing.
This is why the visible UI did not reveal the error even though the route had
received it.

The current handler at
[`app/page.tsx:41`](/Users/jonathan/Codeland/blog-technical/app/page.tsx:41)
reads `j.message || j.error || "Unable to dispatch VC discovery."`; the route
now sends `message` on a total failure at
[`dispatch/route.ts:24`](/Users/jonathan/Codeland/blog-technical/app/api/vc-discovery/dispatch/route.ts:24).

**Wrong principle applied:** “non-2xx status automatically produces a useful
client error.”

**Required principle:** route response schemas must be tested for every branch;
the UI must read fields that the route actually returns.

### 4. The monitor initially watched the wrong kind of work

The existing Collection table polled `/api/runs`, which reads direct URL
`ResearchRun`/`SourceRun` records. VC dispatch instead creates/updates `Job`
records of type `FETCH_FIRM_SOURCES`. They are different state machines.

Consequently a successful VC dispatch would not have appeared in the original
source-run table either. I initially added the buttons without adding a monitor
for their state model.

The current `VcQueueStatus` component polls `/api/vc-discovery` and its
`load` variable is explicitly tied to
[`vcDiscoverySummary`](/Users/jonathan/Codeland/blog-technical/lib/vc-discovery.ts:47)
in [`app/page.tsx:34-37`](/Users/jonathan/Codeland/blog-technical/app/page.tsx:34).

**Wrong principle applied:** “a page with an existing progress table has progress
visibility for new work.”

**Required principle:** the UI monitor must query the exact durable record type
whose state the control changes.

### 5. The outbox topic did not represent the event being sent

The market-map script originally created an outbox row using
`"source-fetch.requested"`, while the dispatcher actually sent a VC discovery
message. `markVcDiscoveryDispatched` and the failure handler filtered for that
old outbox topic. This did not cause Vercel's invalid-topic rejection, but it
made the event ledger semantically misleading and would have made reconciliation
harder.

The script now writes `"vc-discovery-requested"` at
[`scripts/enqueue-market-map.mjs:17`](/Users/jonathan/Codeland/blog-technical/scripts/enqueue-market-map.mjs:17).
The dispatcher updates undelivered outbox rows by `jobId` at
[`lib/vc-discovery.ts:39`](/Users/jonathan/Codeland/blog-technical/lib/vc-discovery.ts:39),
so the already-prepared rows from before the fix still retain retry diagnostics.

### 6. I tried to hide a preparation/dispatch boundary instead of documenting it

After seeing that no jobs were available, I temporarily changed the dispatch
endpoint so a click would create market-map candidates and then dispatch them.
That was not a fix for the queue failure; it changed the mandate of the control.
It also mixed a potentially large candidate-intake decision with a bounded
dispatch action. It was reverted.

The current UI says the control dispatches prepared jobs only at
[`app/page.tsx:41`](/Users/jonathan/Codeland/blog-technical/app/page.tsx:41), and
the component registry assigns separate IDs to dispatch, queue monitoring, and
direct source research in
[`UI-COMPONENT-INDEX.md`](/Users/jonathan/Codeland/blog-technical/docs/UI-COMPONENT-INDEX.md).

**Wrong principle applied:** “when a control cannot do what the user expects,
expand its behavior until it appears to work.”

**Required principle:** preserve a control's mandate; expose the missing
prerequisite or add a separately named control after approval.

## Why the ordinary checks did not catch it

| Check run | What it executes | What it does not execute |
| --- | --- | --- |
| `tsc --noEmit` | Type checking and module resolution | Vercel Queue topic validation, OIDC, HTTP publication, callback delivery |
| `next build` | Bundling, route discovery, static generation | `POST /api/vc-discovery/dispatch`, `send()`, production queue callback |
| `git diff --check` | Whitespace errors | Runtime behavior |
| Local database inspection attempted after the incident | Prisma client initialization | It failed because the local `DATABASE_URL` points at unreachable `db.prisma.io:5432`; it was not a usable production-state inspection path |
| Vercel runtime-log query | Retained runtime logs | The failure was caught rather than logged; the requested earlier window was also outside Hobby log retention |

The build emitted a QueueClient local-region fallback warning. I treated it as
expected local behavior. It was not the cause of the invalid topic, but it was a
signal that the build environment was not exercising the deployed queue path.

## Reproduction procedure for the original bug

1. Deploy code with the pre-fix topic `vc-discovery.requested` in both the
   producer constant and `vercel.json` trigger.
2. Create at least one `FETCH_FIRM_SOURCES` job in `PENDING` state.
3. Call `POST /api/vc-discovery/dispatch` with `{ "limit": 1 }`.
4. Observe `send()` reject because the topic contains a period.
5. Observe the job transition `PENDING → QUEUED → PENDING`; `attempts` stays
   zero because the callback never claims it.
6. In the original UI, observe no useful status because the failed response used
   `failures`, while the client rendered `j.error`.

## Verification required before any future completion claim

The minimum evidence is a deployed, end-to-end single-job run—not another build:

1. Dispatch one known prepared `PENDING` VC job.
2. Capture the 202 response and its returned `jobIds[0]`.
3. Observe that exact job become `QUEUED`, then `RUNNING` with `attempts: 1`.
4. Observe the queue consumer route invoke `claimVcDiscoveryJob()` and start
   `discoverInvestorSources`.
5. Observe a terminal job result (`SUCCEEDED` or a specific persisted failure),
   plus the corresponding document/source/claim records where applicable.
6. Verify that a real queue publication failure, if one occurs, is displayed by
   the queue monitor with its provider error text.

Until steps 1–5 have happened on the deployed environment, the accurate status
is **build-verified, not integration-verified**.
