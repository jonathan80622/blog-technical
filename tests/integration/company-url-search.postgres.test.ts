// Run only against the disposable Postgres service in company-url-search.yml.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { db } from "../../lib/db.ts";
import { searchAndSaveCompanyWebsites } from "../../features/company-url-search/core.ts";
import { companyUrlSearchStore, readCompanyUrlSearches } from "../../features/company-url-search/repository.ts";

const investorId = `url-search-test-${randomUUID()}`;
const links = [{ name: "Fixture company", websiteUrl: "https://company.example/", evidenceUrls: ["https://investor.example/portfolio"] }];
const response = {
  id: "response-fixture", status: "completed",
  output: [
    { type: "web_search_call", status: "completed", action: { sources: [{ url: "https://investor.example/portfolio" }] } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify({ companies: links, notes: "Fixture search" }) }] }
  ]
};

before(async () => {
  await db.investor.create({ data: { id: investorId, name: investorId, canonicalDomain: "investor.example" } });
});
after(async () => {
  await db.companyUrlSearch.deleteMany({ where: { investorId } });
  await db.investor.deleteMany({ where: { id: investorId } });
  await db.$disconnect();
});

test("committed website links and provider response survive an independent database read", async () => {
  const result = await searchAndSaveCompanyWebsites(investorId, { store: companyUrlSearchStore, request: async () => response });
  const row = await db.companyUrlSearch.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(row.state, "SAVED");
  assert.equal(row.resultCount, 1);
  assert.deepEqual(row.links, links);
  assert.deepEqual(row.response, response);
  assert.equal(row.responseId, response.id);
  const history = await readCompanyUrlSearches(investorId);
  assert.deepEqual(history.searches.find(search => search.id === result.id)?.links, links);
  assert.equal(await db.company.count(), 0);
  assert.equal(await db.source.count(), 0);
  assert.equal(await db.job.count(), 0);
  assert.equal(await db.claim.count(), 0);
});

test("database constraints reject a fake SAVED status with no links atomically", async () => {
  const investor = await companyUrlSearchStore.findInvestor(investorId);
  assert.ok(investor);
  const search = await companyUrlSearchStore.start(investor, "fixture", new Date(Date.now() + 60_000));
  await assert.rejects(db.companyUrlSearch.update({ where: { id: search.id }, data: { state: "SAVED" } }));
  const row = await db.companyUrlSearch.findUniqueOrThrow({ where: { id: search.id } });
  assert.equal(row.state, "SEARCHING");
  assert.equal(row.resultCount, 0);
  assert.deepEqual(row.links, []);
});

test("expired searches become FAILED and cannot be overwritten by a late provider response", async () => {
  const investor = await companyUrlSearchStore.findInvestor(investorId);
  assert.ok(investor);
  const search = await companyUrlSearchStore.start(investor, "fixture", new Date(Date.now() - 1_000));
  await readCompanyUrlSearches(investorId);
  await assert.rejects(companyUrlSearchStore.complete(search.id, { links, notes: "late", rejectedCount: 0, responseId: null }, response), /expired/);
  const row = await db.companyUrlSearch.findUniqueOrThrow({ where: { id: search.id } });
  assert.equal(row.state, "FAILED");
  assert.deepEqual(row.links, []);
});

test("a failure callback cannot overwrite already committed website links", async () => {
  const result = await searchAndSaveCompanyWebsites(investorId, { store: companyUrlSearchStore, request: async () => response });
  await companyUrlSearchStore.fail(result.id, "late failure callback");
  const row = await db.companyUrlSearch.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(row.state, "SAVED");
  assert.deepEqual(row.links, links);
});
