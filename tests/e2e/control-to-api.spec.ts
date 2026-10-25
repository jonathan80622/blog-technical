import { expect, test, type Page } from "@playwright/test";

const claim = {
  id: "claim-1",
  predicate: "Uses retrieval augmented generation in production",
  status: "CANDIDATE",
  reviewNote: null,
  company: { name: "Acme AI" },
  evidence: [
    {
      passage: "We use retrieval augmented generation in our product.",
      documentVersion: {
        document: {
          canonicalUrl: "https://acme.example/blog/ai",
          title: "Building with AI",
          publishedAt: "2026-01-02T00:00:00.000Z",
        },
      },
    },
  ],
};

function overview(overrides: Record<string, unknown> = {}) {
  return {
    trends: [],
    investors: [],
    companies: [],
    coverage: [],
    claims: [],
    ...overrides,
  };
}

const zeroPromotionJob = {
  id: "job-1",
  state: "SUCCEEDED",
  attempts: 1,
  progress: "Portfolio source indexed; promoted 0 evidence-backed companies",
  payload: { name: "Northstar Ventures" },
};

async function installOverview(page: Page, data = overview()) {
  await page.route("**/api/overview", (route) => route.fulfill({ json: data }));
}

async function openCollection(page: Page) {
  await page.getByRole("button", { name: "Collection" }).click();
  await expect(page.getByRole("heading", { name: "Collection" })).toBeVisible();
}

async function installEmptyCollectionApis(page: Page) {
  await page.route("**/api/runs", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/vc-discovery", (route) =>
    route.fulfill({
      json: { counts: {}, maxActive: 3, jobs: [] },
    }),
  );
}

test("navigation selects each evidence view; the research shortcut opens Collection", async ({ page }) => {
  let overviewReads = 0;
  const postRequests: string[] = [];
  await page.route("**/api/overview", async (route) => {
    overviewReads++;
    await route.fulfill({ json: overview() });
  });
  await installEmptyCollectionApis(page);
  page.on("request", request => {
    if (request.method() === "POST") postRequests.push(new URL(request.url()).pathname);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI Trends" })).toBeVisible();

  for (const view of ["Investors", "Companies", "Coverage", "Claims", "Sources", "Collection", "Chat"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.getByRole("heading", { name: view, exact: true })).toBeVisible();
  }
  await expect.poll(() => overviewReads).toBe(8);

  await page.getByRole("button", { name: "Request research" }).click();
  await expect(page.getByRole("heading", { name: "Collection", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start once. Monitor every source." })).toBeVisible();
  expect(overviewReads).toBe(8);
  expect(postRequests).toEqual([]);
});

test("AI Trends renders accepted evidence and source links from the overview read model", async ({ page }) => {
  await installOverview(page, overview({
    companies: [
      { id: "acme", name: "Acme AI", canonicalDomain: "acme.example", fundingRounds: [], coverageChecks: [{ taskType: "TECHNICAL_SOURCES", outcome: "VERIFIED" }, { taskType: "HIRING_SIGNALS", outcome: "FAILED" }], sources: [] },
      { id: "beacon", name: "Beacon", canonicalDomain: "beacon.example", fundingRounds: [], coverageChecks: [{ taskType: "TECHNICAL_SOURCES", outcome: "NOT_SEARCHED" }, { taskType: "HIRING_SIGNALS", outcome: "SEARCHED_UNRESOLVED" }], sources: [] },
    ],
    trends: [{
      trend: "retrieval",
      companyCount: 2,
      hiringCompanies: 2,
      technicalCompanies: 1,
      evidence: [
        { claimId: "h1", company: "Acme AI", kind: "hiring_demand", passage: "Hiring engineers to build retrieval systems.", url: "https://acme.example/jobs", versionId: "v1", observedAt: "2026-01-01T00:00:00.000Z", publishedAt: null },
        { claimId: "t1", company: "Acme AI", kind: "technical_use", passage: "We run retrieval in our production support service.", url: "https://acme.example/blog/ai", versionId: "v2", observedAt: "2026-01-02T00:00:00.000Z", publishedAt: "2025-12-01T00:00:00.000Z" },
        { claimId: "h2", company: "Beacon", kind: "hiring_demand", passage: "Hiring engineers to evaluate retrieval systems.", url: "https://beacon.example/jobs", versionId: "v3", observedAt: "2026-01-03T00:00:00.000Z", publishedAt: null },
      ],
    }],
  }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "retrieval" })).toBeVisible();
  await expect(page.getByText("2 companies · 2 hiring · 1 technical use")).toBeVisible();
  await expect(page.locator(".coverage-note")).toContainText("Denominator: 2 promoted candidates.");
  await expect(page.locator(".coverage-note")).toContainText("Technical sources: 1 verified, 1 not searched.");
  await expect(page.locator(".coverage-note")).toContainText("Hiring signals: 1 failed, 1 searched unresolved.");
  await expect(page.getByText("Acme AI · hiring demand")).toBeVisible();
  await expect(page.getByText("Acme AI · technical use")).toBeVisible();
  await expect(page.getByText("Publication date unknown").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open original evidence" })).toHaveCount(3);

  await page.context().route("https://acme.example/**", (route) => route.fulfill({ body: "Saved evidence source" }));
  const sourcePage = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open original evidence" }).first().click();
  await expect(await sourcePage).toHaveURL("https://acme.example/jobs");
});

test("Investors, Companies, and Coverage show persisted records from the overview request", async ({ page }) => {
  await installOverview(page, overview({
    investors: [{ id: "investor-1", name: "Northstar Ventures", rationale: "Focuses on infrastructure software.", portfolioRelationships: [{ id: "portfolio-1" }] }],
    companies: [{
      id: "company-1", name: "Acme AI", canonicalDomain: "acme.example",
      fundingRounds: [{ stage: "Series A", status: "CANDIDATE" }],
      coverageChecks: [{ taskType: "HIRING_SIGNALS", outcome: "FAILED" }],
      sources: [{ url: "https://acme.example/jobs", type: "hiring_posting" }],
    }],
    coverage: [{ outcome: "FAILED", _count: { _all: 1 } }],
  }));
  await page.goto("/");

  await page.getByRole("button", { name: "Investors", exact: true }).click();
  await expect(page.getByText("Northstar Ventures")).toBeVisible();
  await expect(page.getByText("Focuses on infrastructure software.")).toBeVisible();
  await expect(page.getByText("1 evidence-backed portfolio links")).toBeVisible();

  await page.getByRole("button", { name: "Companies", exact: true }).click();
  await expect(page.getByText("Acme AI")).toBeVisible();
  await expect(page.getByText("Series A · CANDIDATE")).toBeVisible();
  await expect(page.getByText("FAILED", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Coverage", exact: true }).click();
  await expect(page.getByText("HIRING_SIGNALS")).toBeVisible();
  await expect(page.getByText("Inspect record")).toBeVisible();
  await expect(page.getByText("Inspect record")).not.toHaveAttribute("href");
});

test("Claims and Sources open their original evidence URLs", async ({ page }) => {
  await installOverview(page, overview({
    claims: [claim],
    companies: [{
      id: "company-1", name: "Acme AI", canonicalDomain: "acme.example", fundingRounds: [], coverageChecks: [],
      sources: [{ url: "https://acme.example/jobs", type: "hiring_posting" }],
    }],
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Claims", exact: true }).click();
  await page.context().route("https://acme.example/**", route => route.fulfill({ body: "Saved source fixture" }));
  const claimPopup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Building with AI" }).click();
  await expect(await claimPopup).toHaveURL("https://acme.example/blog/ai");

  await page.getByRole("button", { name: "Sources", exact: true }).click();
  const sourcePopup = page.waitForEvent("popup");
  await page.getByRole("link", { name: /Open source/ }).click();
  await expect(await sourcePopup).toHaveURL("https://acme.example/jobs");
});

test("mobile Collection keeps dispatch controls visible and connected", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installOverview(page);
  await installEmptyCollectionApis(page);
  let dispatched: unknown;
  await page.route("**/api/vc-discovery/dispatch", async (route) => {
    dispatched = route.request().postDataJSON();
    await route.fulfill({ status: 202, json: { state: "QUEUED", jobIds: ["mobile-job"] } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Collection", exact: true }).click();
  const dispatch = page.getByRole("button", { name: "Dispatch 1 prepared VC" });
  await expect(dispatch).toBeVisible();
  await dispatch.click();
  await expect(page.getByText("1 VC discovery jobs queued.")).toBeVisible();
  expect(dispatched).toEqual({ limit: 1 });
});

test("overview loading resolves to the explicit empty trend state", async ({ page }) => {
  let finish!: () => void;
  const responsePending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/overview", async (route) => {
    await responsePending;
    await route.fulfill({ json: overview() });
  });

  await page.goto("/");
  await expect(page.getByText("Loading research records…")).toBeVisible();
  finish();
  await expect(page.getByText("No accepted AI signals yet.")).toBeVisible();
});

test("overview failure is visible to the user", async ({ page }) => {
  await page.route("**/api/overview", (route) =>
    route.fulfill({ status: 503, json: { error: "Database connection unavailable." } }),
  );

  await page.goto("/");
  await expect(page.getByText("Database connection unavailable.")).toBeVisible();
});

test("overview refresh failure after navigation remains visible", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/overview", route => {
    reads++;
    return reads === 1
      ? route.fulfill({ json: overview() })
      : route.fulfill({ status: 503, json: { error: "Overview refresh unavailable." } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Companies", exact: true }).click();
  await expect(page.getByText("Unable to refresh records.")).toBeVisible();
});

test("research submits the selected source type and shows an accepted run", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  const submitted: unknown[] = [];
  let finishSubmission!: () => void;
  let submissionPending = new Promise<void>((resolve) => { finishSubmission = resolve; });
  await page.route("**/api/research", async (route) => {
    submitted.push(route.request().postDataJSON());
    await submissionPending;
    await route.fulfill({ status: 202, json: { runId: `run-${submitted.length}` } });
  });

  await page.goto("/");
  await openCollection(page);
  const kinds = [
    ["TECHNICAL_BLOG", "https://acme.example/blog/ai"],
    ["HIRING_POSTING", "https://acme.example/jobs"],
    ["VC_PORTFOLIO", "https://investor.example/companies"],
  ];
  for (const [index, [kind, url]] of kinds.entries()) {
    submissionPending = new Promise<void>((resolve) => { finishSubmission = resolve; });
    await page.getByLabel("Source type").selectOption(kind);
    const sourceUrl = page.getByLabel("Official portfolio, hiring page, or technical blog URL");
    await sourceUrl.fill(url);
    await page.getByRole("button", { name: "Start research" }).click();
    const submitting = page.getByRole("button", { name: "Submitting…" });
    await expect(submitting).toBeDisabled();
    finishSubmission();
    await expect(page.getByText(`Research run run-${index + 1} accepted for collection.`)).toBeVisible();
    await expect(sourceUrl).toHaveValue("");
  }
  expect(submitted).toEqual(kinds.map(([sourceKind, url]) => ({ sourceKind, url })));
});

test("browser URL validation prevents a malformed research request from reaching the API", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  let requestCount = 0;
  await page.route("**/api/research", async (route) => {
    requestCount += 1;
    await route.fulfill({ status: 202, json: { runId: "unexpected" } });
  });

  await page.goto("/");
  await openCollection(page);
  const url = page.getByLabel("Official portfolio, hiring page, or technical blog URL");
  await url.fill("not a URL");
  await page.getByRole("button", { name: "Start research" }).click();

  expect(await url.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  expect(requestCount).toBe(0);
});

test("research API validation and service failures are rendered as alerts", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  await page.route("**/api/research", (route) =>
    route.fulfill({ status: 400, json: { error: "Source URL must resolve only to public IP addresses." } }),
  );

  await page.goto("/");
  await openCollection(page);
  await page.getByLabel("Official portfolio, hiring page, or technical blog URL").fill("https://127.0.0.1/private");
  await page.getByRole("button", { name: "Start research" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Source URL must resolve only to public IP addresses.");

  await page.route("**/api/research", (route) =>
    route.fulfill({ status: 503, json: { error: "Collection service unavailable." } }),
  );
  await page.getByLabel("Official portfolio, hiring page, or technical blog URL").fill("https://acme.example/blog");
  await page.getByRole("button", { name: "Start research" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Collection service unavailable.");
});

test("claim review sends the selected status and updates the visible claim", async ({ page }) => {
  await installOverview(page, overview({ claims: [claim] }));
  let patchUrl = "";
  let patchBody: unknown;
  let finishReview!: () => void;
  const reviewPending = new Promise<void>((resolve) => { finishReview = resolve; });
  await page.route("**/api/claims/**", async (route) => {
    patchUrl = new URL(route.request().url()).pathname;
    patchBody = route.request().postDataJSON();
    await reviewPending;
    await route.fulfill({ json: { ...claim, status: "ACCEPTED" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Claims", exact: true }).click();
  const accept = page.getByRole("button", { name: "Accept" });
  await accept.click();
  await expect(page.getByText("Saving review…")).toBeVisible();
  await expect(accept).toBeDisabled();
  finishReview();

  await expect(page.getByText("ACCEPTED", { exact: true })).toBeVisible();
  expect(patchUrl).toBe("/api/claims/claim-1");
  expect(patchBody).toEqual({ status: "ACCEPTED" });
});

test("claim review failure leaves the prior status visible and shows an alert", async ({ page }) => {
  await installOverview(page, overview({ claims: [claim] }));
  await page.route("**/api/claims/**", (route) =>
    route.fulfill({ status: 409, json: { error: "Evidence changed; reload before reviewing." } }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Claims", exact: true }).click();
  await page.getByRole("button", { name: "Reject" }).click();

  await expect(page.locator('p[role="alert"]')).toContainText("Evidence changed; reload before reviewing.");
  await expect(page.getByText("CANDIDATE", { exact: true })).toBeVisible();
});

test("Reject sends the rejected state and removes the claim from the review candidate state", async ({ page }) => {
  await installOverview(page, overview({ claims: [claim] }));
  let requestBody: unknown;
  await page.route("**/api/claims/**", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({ json: { ...claim, status: "REJECTED" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Claims", exact: true }).click();
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("REJECTED", { exact: true })).toBeVisible();
  expect(requestBody).toEqual({ status: "REJECTED" });
});

test("VC dispatch controls send their requested batch size and show queued work", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  const bodies: unknown[] = [];
  let finishDispatch!: () => void;
  const dispatchPending = new Promise<void>((resolve) => { finishDispatch = resolve; });
  await page.route("**/api/vc-discovery/dispatch", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) await dispatchPending;
    await route.fulfill({ status: 202, json: { state: "QUEUED", jobIds: ["job-1"] } });
  });

  await page.goto("/");
  await openCollection(page);
  await page.getByRole("button", { name: "Dispatch next 5 prepared VCs" }).click();
  await expect(page.getByText("Dispatching…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Dispatch next 5 prepared VCs" })).toBeDisabled();
  finishDispatch();
  await expect(page.getByText("1 VC discovery jobs queued.")).toBeVisible();
  await page.getByRole("button", { name: "Dispatch 1 prepared VC" }).click();
  await expect(page.getByText("1 VC discovery jobs queued.")).toBeVisible();

  expect(bodies).toEqual([{ limit: 5 }, { limit: 1 }]);
});

test("local VC dispatch reports the directly started workflow", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  await page.route("**/api/vc-discovery/dispatch", route => route.fulfill({
    status: 202,
    json: { state: "STARTED", mode: "local", jobIds: ["job-1"] },
  }));

  await page.goto("/");
  await openCollection(page);
  await page.getByRole("button", { name: "Dispatch 1 prepared VC" }).click();
  await expect(page.getByText("1 VC discovery workflows started.")).toBeVisible();
});

test("partial VC dispatch makes the failed count and pending recovery visible", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  await page.route("**/api/vc-discovery/dispatch", (route) =>
    route.fulfill({ status: 202, json: { state: "PARTIAL", jobIds: ["job-1"], failedJobCount: 2, compensationFailureCount: 1 } }),
  );

  await page.goto("/");
  await openCollection(page);
  await page.getByRole("button", { name: "Dispatch next 5 prepared VCs" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("1 queued; 2 failed and returned to pending");
  await expect(page.locator('p[role="alert"]')).toContainText("1 could not be returned to pending.");
});

test("VC dispatch failure is visible", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  await page.route("**/api/vc-discovery/dispatch", (route) =>
    route.fulfill({ status: 503, json: { error: "Queue provider unavailable." } }),
  );

  await page.goto("/");
  await openCollection(page);
  await page.getByRole("button", { name: "Dispatch 1 prepared VC" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Queue provider unavailable.");
});

test("dispatch warns if a failed publication could not be returned to pending", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  await page.route("**/api/vc-discovery/dispatch", route => route.fulfill({
    status: 503,
    json: { error: "No VC discovery jobs were queued; one or more jobs could not be returned to pending. Check the queue monitor before retrying." },
  }));
  await page.goto("/");
  await openCollection(page);
  await page.getByRole("button", { name: "Dispatch 1 prepared VC" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("could not be returned to pending");
  await expect(page.locator('p[role="alert"]')).toContainText("Check the queue monitor before retrying.");
});

test("dispatch explains empty, active, and capacity-full queue states", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  const cases = [
    "No market-map jobs are prepared.",
    "All available VC discovery work is already in progress.",
    "VC jobs are waiting but all 5 discovery slots are active. Try again after one completes.",
  ];
  let response = "";
  await page.route("**/api/vc-discovery/dispatch", async route => {
    await route.fulfill({ json: { state: "IDLE", message: response } });
  });
  await page.goto("/");
  await openCollection(page);
  for (const message of cases) {
    response = message;
    await page.getByRole("button", { name: "Dispatch 1 prepared VC" }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  }
});

test("outbox tracking failure after publish stays visible as queued work", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  await page.route("**/api/vc-discovery/dispatch", route => route.fulfill({
    status: 202,
    json: {
      state: "PARTIAL", jobIds: ["job-1"], requested: 1, failedJobCount: 0,
      compensationFailureCount: 0, trackingFailureCount: 1,
      message: "Queue accepted work, but dispatch tracking could not be updated. The jobs remain queued; check the queue monitor.",
    },
  }));
  await page.goto("/");
  await openCollection(page);
  await page.getByRole("button", { name: "Dispatch 1 prepared VC" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Queue accepted work");
  await expect(page.locator('p[role="alert"]')).toContainText("jobs remain queued");
});

test("zero-promotion replay posts the job ID and shows the requeued state", async ({ page }) => {
  await installOverview(page);
  let replayed = false;
  await page.route("**/api/runs", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/vc-discovery", (route) =>
    route.fulfill({
      json: {
        counts: { PENDING: replayed ? 1 : 0 },
        maxActive: 3,
        jobs: [replayed ? { ...zeroPromotionJob, state: "PENDING" } : zeroPromotionJob],
      },
    }),
  );
  let replayBody: unknown;
  let finishReplay!: () => void;
  const replayPending = new Promise<void>((resolve) => { finishReplay = resolve; });
  await page.route("**/api/vc-discovery/replay", async (route) => {
    replayBody = route.request().postDataJSON();
    await replayPending;
    replayed = true;
    await route.fulfill({ json: { message: "Replay prepared; dispatch to start." } });
  });

  await page.goto("/");
  await openCollection(page);
  const replay = page.getByRole("button", { name: "Replay 0-promotion result" });
  await expect(page.getByText("Portfolio source indexed; promoted 0 evidence-backed companies", { exact: false })).toBeVisible();
  await expect(page.getByText("SUCCEEDED", { exact: true })).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("capacity 3")).toBeVisible();
  await replay.click();

  await expect(page.getByText("Preparing replay…")).toBeVisible();
  await expect(replay).toBeDisabled();
  finishReplay();
  await expect(page.getByText("Replay prepared; dispatch to start.")).toBeVisible();
  await expect(page.getByText("PENDING", { exact: true })).toBeVisible();
  expect(replayBody).toEqual({ jobId: "job-1" });
});

test("replay failure is visible and empty queue and run monitors explain their state", async ({ page }) => {
  await installOverview(page);
  await installEmptyCollectionApis(page);
  await page.route("**/api/vc-discovery/replay", (route) =>
    route.fulfill({ status: 409, json: { error: "Only a completed zero-promotion job can be replayed." } }),
  );

  await page.goto("/");
  await openCollection(page);
  await expect(page.getByText("No VC discovery jobs yet.")).toBeVisible();
  await expect(page.getByText("No research runs yet.")).toBeVisible();

  // The UI only exposes replay for a succeeded zero-promotion job.
  await page.unroute("**/api/vc-discovery");
  await page.route("**/api/vc-discovery", (route) =>
    route.fulfill({ json: { counts: {}, maxActive: 3, jobs: [zeroPromotionJob] } }),
  );
  await page.reload();
  await openCollection(page);
  await page.getByRole("button", { name: "Replay 0-promotion result" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Only a completed zero-promotion job can be replayed.");
});

test("collection monitor failures are visible while retries remain pending", async ({ page }) => {
  await installOverview(page);
  await page.route("**/api/runs", (route) =>
    route.fulfill({ status: 503, json: { error: "Run store unavailable." } }),
  );
  await page.route("**/api/vc-discovery", (route) =>
    route.fulfill({ status: 503, json: { error: "Queue store unavailable." } }),
  );

  await page.goto("/");
  await openCollection(page);
  await expect(page.getByText("Run monitor: Run store unavailable.")).toBeVisible();
  await expect(page.getByText("Queue: Queue store unavailable.")).toBeVisible();
  await expect(page.getByText("Run records unavailable. Retrying…")).toBeVisible();
  await expect(page.getByText("Queue records unavailable. Retrying…")).toBeVisible();
});

test("source run monitor displays state, retry, and latest event from the API", async ({ page }) => {
  await installOverview(page);
  await page.route("**/api/runs", route => route.fulfill({ json: [{
    id: "run-1", label: "Acme hiring", state: "RETRY_SCHEDULED",
    sourceRuns: [{
      id: "source-run-1", url: "https://acme.example/jobs", sourceKind: "HIRING_POSTING",
      state: "RETRY_SCHEDULED", stage: "Retry scheduled", attempts: 1, maxAttempts: 3,
      nextRetryAt: "2026-10-25T18:00:00.000Z",
      events: [{ id: "event-1", message: "Attempt 1 failed; retrying.", createdAt: "2026-10-25T17:59:30.000Z" }],
    }],
  }] }));
  await page.route("**/api/vc-discovery", route => route.fulfill({ json: { counts: {}, maxActive: 3, jobs: [] } }));

  await page.goto("/");
  await openCollection(page);
  await expect(page.getByText("HIRING POSTING", { exact: true })).toBeVisible();
  await expect(page.locator(".tr.row small").filter({ hasText: "Retry scheduled" })).toBeVisible();
  await expect(page.getByText("1 / 3")).toBeVisible();
  await expect(page.getByText("Attempt 1 failed; retrying.")).toBeVisible();
  await expect(page.getByText(/retry/).first()).toBeVisible();
});
