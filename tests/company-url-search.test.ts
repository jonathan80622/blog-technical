import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MODEL, InvestorNotFound, parseSearchResponse, requestCompanyWebsites,
  searchAndSaveCompanyWebsites, type SearchStore, type SearchView, type SearchResult
} from "../features/company-url-search/core.ts";

const investor = { id: "investor-1", name: "Example Capital", canonicalDomain: "example.vc" };
const company = { name: "Example Company", websiteUrl: "https://company.example/", evidenceUrls: ["https://example.vc/companies/example"] };
function payload(companies: unknown[] = [company]) {
  return {
    id: "resp_1", status: "completed",
    output: [
      { type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: "https://example.vc/companies/example" }] } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ companies, notes: "Search results may be incomplete." }), annotations: [{ type: "url_citation", url: "https://example.vc/companies/example" }] }] }
    ]
  };
}

function fixture(options: { unknownInvestor?: boolean; databaseFails?: boolean } = {}) {
  const writes: Array<{ operation: string; value: unknown }> = [];
  const saved: SearchView = {
    id: "search-1", investorId: investor.id, investorName: investor.name, state: "SEARCHING",
    links: [], resultCount: 0, rejectedCount: 0, notes: null, error: null, createdAt: new Date().toISOString()
  };
  const store: SearchStore = {
    findInvestor: async () => options.unknownInvestor ? null : investor,
    async start(identity, model, expiresAt) {
      writes.push({ operation: "start", value: { identity, model, expiresAt } });
      return { id: saved.id };
    },
    async complete(id, result, response) {
      if (options.databaseFails) throw new Error("injected database outage");
      writes.push({ operation: "complete", value: { id, result, response } });
      Object.assign(saved, result, { state: result.links.length ? "SAVED" : "EMPTY", resultCount: result.links.length });
      return saved;
    },
    async fail(id, error, response) {
      writes.push({ operation: "fail", value: { id, error, response } });
      Object.assign(saved, { state: "FAILED", error });
    }
  };
  return { store, writes, saved };
}

test("only OpenAI Responses is called, with web search and retained source metadata requested", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(payload()), { status: 200 });
  };
  const response = await requestCompanyWebsites(investor, DEFAULT_MODEL, { apiKey: "test-key", fetch: fakeFetch });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.deepEqual(calls[0].body.tools, [{ type: "web_search" }]);
  assert.equal(calls[0].body.tool_choice, "required");
  assert.deepEqual(calls[0].body.include, ["web_search_call.action.sources"]);
  assert.equal(parseSearchResponse(response, investor).links[0].websiteUrl, company.websiteUrl);
});

test("returns invested-company websites, preserving references and deduplicating www variants", () => {
  const result = parseSearchResponse(payload([company, { ...company, websiteUrl: "https://www.company.example/" }]), investor);
  assert.deepEqual(result.links, [company]);
  assert.equal(result.responseId, "resp_1");
});

test("drops invalid/investor URLs without discarding valid company results", () => {
  const result = parseSearchResponse(payload([
    company, { ...company, websiteUrl: "javascript:alert(1)" },
    { ...company, websiteUrl: "https://example.vc/companies/other" },
    { ...company, websiteUrl: "https://user:password@other.example/" }
  ]), investor);
  assert.deepEqual(result.links, [company]);
  assert.equal(result.rejectedCount, 3);
});

test("a website can be saved without exact local quotes or a supporting URL", () => {
  const result = parseSearchResponse(payload([{ ...company, evidenceUrls: [] }]), investor);
  assert.equal(result.links.length, 1);
  assert.deepEqual(result.links[0].evidenceUrls, []);
});

test("invalid-only responses fail rather than masquerading as an empty successful search", () => {
  assert.throws(() => parseSearchResponse(payload([{ ...company, websiteUrl: "https://example.vc/portfolio" }]), investor), /none contained/);
});

test("incomplete output and output without an actual web search are rejected", () => {
  assert.throws(() => parseSearchResponse({ ...payload(), status: "incomplete" }, investor), /did not complete/);
  assert.throws(() => parseSearchResponse({ ...payload(), output: payload().output.slice(1) }, investor), /no completed web search/);
});

test("returns only committed results and preserves the complete provider response", async () => {
  const f = fixture(); const response = payload();
  const result = await searchAndSaveCompanyWebsites(investor.id, { store: f.store, request: async () => response, model: "  " });
  assert.equal(result, f.saved);
  assert.equal(result.state, "SAVED");
  assert.equal(result.resultCount, 1);
  assert.deepEqual(f.writes.map(write => write.operation), ["start", "complete"]);
  assert.equal((f.writes[0].value as { model: string }).model, DEFAULT_MODEL);
  assert.equal((f.writes[1].value as { response: unknown }).response, response);
});

test("a completed empty search is persisted as EMPTY, never SAVED", async () => {
  const f = fixture();
  const result = await searchAndSaveCompanyWebsites(investor.id, { store: f.store, request: async () => payload([]) });
  assert.equal(result.state, "EMPTY");
  assert.equal(result.resultCount, 0);
});

test("a database write failure never returns the model's unsaved links", async () => {
  const f = fixture({ databaseFails: true });
  await assert.rejects(searchAndSaveCompanyWebsites(investor.id, { store: f.store, request: async () => payload() }), /database outage/);
  assert.equal(f.saved.state, "FAILED");
  assert.equal(f.saved.links.length, 0);
  assert.deepEqual(f.writes.map(write => write.operation), ["start", "fail"]);
});

test("invalid provider output retains its diagnostics in a failed search", async () => {
  const f = fixture(); const response = { ...payload(), status: "incomplete" };
  await assert.rejects(searchAndSaveCompanyWebsites(investor.id, { store: f.store, request: async () => response }), /did not complete/);
  assert.equal(f.saved.state, "FAILED");
  assert.equal((f.writes.at(-1)?.value as { response: unknown }).response, response);
});

test("unknown investors cannot initiate a paid request", async () => {
  const f = fixture({ unknownInvestor: true }); let calls = 0;
  await assert.rejects(searchAndSaveCompanyWebsites("missing", { store: f.store, request: async () => { calls++; return payload(); } }), InvestorNotFound);
  assert.equal(calls, 0);
  assert.equal(f.writes.length, 0);
});

test("provider HTTP failure is persisted, with no saved company links", async () => {
  const f = fixture();
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
  await assert.rejects(searchAndSaveCompanyWebsites(investor.id, {
    store: f.store,
    request: (identity, model) => requestCompanyWebsites(identity, model, { apiKey: "test-key", fetch: fakeFetch })
  }), /HTTP 429/);
  assert.equal(f.saved.state, "FAILED");
  assert.deepEqual((f.writes.at(-1)?.value as { response: unknown }).response, { error: { message: "rate limited" } });
});
