import { expect, test } from "@playwright/test";
import { e2eDb, resetDatabase } from "./database";

const retrievalPassage = "We use retrieval augmented generation in our production support service.";
const hiringPassage = "We are hiring engineers to build retrieval systems for customers.";

async function sourceWithEvidence(companyId: string, type: string, url: string, passage: string) {
  return e2eDb.source.create({ data: { companyId, type, url, capabilities: [], documents: { create: { canonicalUrl: url, contentHash: `${type}-${companyId}`, versions: { create: { body: passage, parserVersion: "e2e" } } } } }, include: { documents: { include: { versions: true } } } });
}
async function signal(companyId: string, kind: "hiring_demand" | "technical_use", passage: string, versionId: string, status: "CANDIDATE" | "ACCEPTED" | "REJECTED" = "CANDIDATE") {
  return e2eDb.claim.create({ data: { companyId, predicate: "ai_signal", value: { trend: "retrieval", kind }, status, evidence: { create: { documentVersionId: versionId, passage } } } });
}

test.beforeEach(async () => resetDatabase());
test.afterAll(async () => { await resetDatabase(); await e2eDb.$disconnect(); });

test("Scenario: Show accepted trend evidence with distinct company counts", async ({ page }) => {
  const acme = await e2eDb.company.create({ data: { name: "Acme AI", canonicalDomain: "acme.example" } });
  const beacon = await e2eDb.company.create({ data: { name: "Beacon", canonicalDomain: "beacon.example" } });
  const acmeTechnical = await sourceWithEvidence(acme.id, "technical_article", "https://acme.example/technical", retrievalPassage);
  const acmeHiring = await sourceWithEvidence(acme.id, "hiring_posting", "https://acme.example/jobs", hiringPassage);
  const beaconHiring = await sourceWithEvidence(beacon.id, "hiring_posting", "https://beacon.example/jobs", hiringPassage);
  await Promise.all([
    signal(acme.id, "technical_use", retrievalPassage, acmeTechnical.documents[0].versions[0].id, "ACCEPTED"),
    signal(acme.id, "hiring_demand", hiringPassage, acmeHiring.documents[0].versions[0].id, "ACCEPTED"),
    signal(beacon.id, "hiring_demand", hiringPassage, beaconHiring.documents[0].versions[0].id, "ACCEPTED"),
    e2eDb.coverageCheck.createMany({ data: [
      { companyId: acme.id, taskType: "TECHNICAL_SOURCES", scope: {}, outcome: "VERIFIED" }, { companyId: acme.id, taskType: "HIRING_SIGNALS", scope: {}, outcome: "FAILED" },
      { companyId: beacon.id, taskType: "TECHNICAL_SOURCES", scope: {}, outcome: "NOT_SEARCHED" }, { companyId: beacon.id, taskType: "HIRING_SIGNALS", scope: {}, outcome: "SEARCHED_UNRESOLVED" },
    ] }),
  ]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "retrieval" })).toBeVisible();
  await expect(page.getByText("2 companies · 2 hiring · 1 technical use")).toBeVisible();
  await expect(page.locator(".coverage-note")).toContainText("Denominator: 2 promoted candidates.");
  await expect(page.locator(".coverage-note")).toContainText("Technical sources: 1 verified, 1 not searched.");
  await expect(page.locator(".coverage-note")).toContainText("Hiring signals: 1 failed, 1 searched unresolved.");
  await expect(page.getByText("Acme AI · technical use")).toBeVisible();
  await expect(page.getByText("Beacon · hiring demand")).toBeVisible();
  await expect(page.getByText(retrievalPassage)).toBeVisible();
  await expect(page.getByText(hiringPassage)).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Open original evidence" })).toHaveCount(3);
  await expect(page.getByText("Publication date unknown")).toHaveCount(3);
  await expect(page.getByText(/These counts do not establish spending, market share, or growth over time/)).toBeVisible();
});

test("Scenario: Accept a supported AI signal", async ({ page }) => {
  const company = await e2eDb.company.create({ data: { name: "Acme AI", canonicalDomain: "acme.example" } });
  const source = await sourceWithEvidence(company.id, "technical_article", "https://acme.example/technical", retrievalPassage);
  const claim = await signal(company.id, "technical_use", retrievalPassage, source.documents[0].versions[0].id);
  await page.goto("/");
  await page.getByRole("button", { name: "Claims", exact: true }).click();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("ACCEPTED", { exact: true })).toBeVisible();
  await expect.poll(async () => (await e2eDb.claim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("ACCEPTED");
  await page.getByRole("button", { name: "AI Trends", exact: true }).click();
  await expect(page.getByText("1 companies · 0 hiring · 1 technical use")).toBeVisible();
});

test("Scenario: Reject a candidate so it does not contribute to trends", async ({ page }) => {
  const company = await e2eDb.company.create({ data: { name: "Acme AI", canonicalDomain: "acme.example" } });
  const source = await sourceWithEvidence(company.id, "technical_article", "https://acme.example/technical", retrievalPassage);
  const claim = await signal(company.id, "technical_use", retrievalPassage, source.documents[0].versions[0].id);
  await page.goto("/");
  await page.getByRole("button", { name: "Claims", exact: true }).click();
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("REJECTED", { exact: true })).toBeVisible();
  await expect.poll(async () => (await e2eDb.claim.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe("REJECTED");
  await page.getByRole("button", { name: "AI Trends", exact: true }).click();
  await expect(page.getByText("No accepted AI signals yet.")).toBeVisible();
});

test("Scenario: Monitor VC jobs and explicitly replay a zero-promotion result", async ({ page }) => {
  const job = await e2eDb.job.create({ data: { type: "FETCH_FIRM_SOURCES", deduplicationKey: "e2e-zero-promotion", state: "SUCCEEDED", attempts: 1, progress: "Portfolio source indexed; promoted 0 evidence-backed companies", payload: { name: "Northstar Ventures" } } });
  await page.goto("/");
  await page.getByRole("button", { name: "Collection", exact: true }).click();
  await expect(page.getByText("Northstar Ventures")).toBeVisible();
  await page.getByRole("button", { name: "Replay 0-promotion result" }).click();
  await expect(page.getByText("Promotion replay prepared. Dispatch one VC to start it.")).toBeVisible();
  await expect.poll(async () => (await e2eDb.job.findUniqueOrThrow({ where: { id: job.id } })).state).toBe("PENDING");
});

test("Scenario: Explain why no VC jobs were dispatched", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Collection", exact: true }).click();
  await page.getByRole("button", { name: "Dispatch 1 prepared VC" }).click();
  await expect(page.getByText("No market-map jobs are prepared. Prepare candidates through the explicit market-map batch before dispatching them.")).toBeVisible();
});
