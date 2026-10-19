// This feature discovers and persists links. It has no collection/indexing dependencies.
export const DEFAULT_MODEL = "gpt-5.5";
export const SEARCH_TIMEOUT_MS = 120_000;
export const SEARCH_LIFETIME_MS = 150_000;

export type InvestorIdentity = { id: string; name: string; canonicalDomain: string | null };
export type CompanyWebsite = { name: string; websiteUrl: string; evidenceUrls: string[] };
export type SearchState = "SEARCHING" | "SAVED" | "EMPTY" | "FAILED";
export type SearchView = {
  id: string; investorId: string; investorName: string; state: SearchState;
  links: CompanyWebsite[]; resultCount: number; rejectedCount: number;
  notes: string | null; error: string | null; createdAt: string;
};
export type SearchResult = {
  links: CompanyWebsite[]; notes: string; rejectedCount: number; responseId: string | null;
};
export interface SearchStore {
  findInvestor(id: string): Promise<InvestorIdentity | null>;
  start(investor: InvestorIdentity, model: string, expiresAt: Date): Promise<{ id: string }>;
  complete(id: string, result: SearchResult, response: unknown): Promise<SearchView>;
  fail(id: string, error: string, response?: unknown): Promise<void>;
}

export class InvestorNotFound extends Error {}
export class SearchRequestError extends Error {
  response?: unknown;
  constructor(message: string, response?: unknown) { super(message); this.response = response; }
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function webUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}
const domain = (host: string) => host.toLowerCase().replace(/^www\./, "");

export function parseSearchResponse(response: unknown, investor: InvestorIdentity): SearchResult {
  if (!object(response) || response.status !== "completed" || response.error) {
    throw new SearchRequestError("OpenAI did not complete the search. No result has been marked as saved.");
  }
  const output = Array.isArray(response.output) ? response.output.filter(object) : [];
  if (!output.some(item => item.type === "web_search_call" && item.status === "completed")) {
    throw new SearchRequestError("OpenAI returned no completed web search.");
  }
  const text = output.filter(item => item.type === "message").flatMap(item =>
    Array.isArray(item.content) ? item.content.filter(object) : []
  ).filter(item => item.type === "output_text" && typeof item.text === "string").map(item => item.text).join("");
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new SearchRequestError("OpenAI returned an unreadable company website list."); }
  if (!object(data) || !Array.isArray(data.companies) || typeof data.notes !== "string") {
    throw new SearchRequestError("OpenAI returned an invalid company website list.");
  }
  const links: CompanyWebsite[] = [];
  const seen = new Set<string>();
  let rejectedCount = 0;
  const investorDomain = investor.canonicalDomain ? domain(investor.canonicalDomain) : null;
  for (const item of data.companies) {
    if (!object(item) || typeof item.name !== "string" || typeof item.websiteUrl !== "string" ||
        !Array.isArray(item.evidenceUrls) || !item.evidenceUrls.every(url => typeof url === "string")) {
      throw new SearchRequestError("OpenAI returned a malformed company website entry.");
    }
    const url = webUrl(item.websiteUrl);
    const host = url ? domain(url.hostname) : "";
    if (!item.name.trim() || item.name.length > 200 || !url ||
        (investorDomain && (host === investorDomain || host.endsWith(`.${investorDomain}`)))) {
      rejectedCount++;
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    const evidenceUrls = [...new Set((item.evidenceUrls as string[]).flatMap(value => {
      const reference = webUrl(value); return reference ? [reference.toString()] : [];
    }))];
    links.push({ name: item.name.trim(), websiteUrl: url.toString(), evidenceUrls });
  }
  if (data.companies.length && !links.length) {
    throw new SearchRequestError("The search returned entries, but none contained an eligible company website URL.");
  }
  return { links, notes: data.notes, rejectedCount, responseId: typeof response.id === "string" ? response.id : null };
}

export async function requestCompanyWebsites(
  investor: InvestorIdentity, model: string,
  options: { apiKey?: string; fetch?: typeof fetch } = {}
): Promise<unknown> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new SearchRequestError("OPENAI_API_KEY is not configured.");
  const response = await (options.fetch ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search" }], tool_choice: "required",
      include: ["web_search_call.action.sources"], max_output_tokens: 6_000,
      text: { format: { type: "json_schema", name: "invested_company_websites", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: {
          companies: { type: "array", maxItems: 30, items: {
            type: "object", additionalProperties: false,
            properties: { name: { type: "string" }, websiteUrl: { type: "string" }, evidenceUrls: { type: "array", items: { type: "string" } } },
            required: ["name", "websiteUrl", "evidenceUrls"]
          } },
          notes: { type: "string" }
        }, required: ["companies", "notes"]
      } } },
      instructions: "Use web search to identify companies that this investor has invested in and find each company's own official website. Return up to 30 distinct companies. websiteUrl must be the company's website, not the investor's portfolio/detail page, a funding announcement, social profile, or directory. Do not guess domains. Include supporting investment/identity source URLs in evidenceUrls where available. Omit companies whose website cannot be established. An empty list is allowed. Explain ambiguous identity, stale evidence, and incomplete coverage briefly in notes. These are search findings, not independently verified investment claims.",
      input: `Investor: ${investor.name}\nKnown investor domain: ${investor.canonicalDomain ?? "unresolved"}`
    })
  });
  let payload: unknown;
  try { payload = await response.json(); } catch {
    throw new SearchRequestError(`OpenAI returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    // Persist provider diagnostics but do not expose arbitrary upstream bodies to the browser.
    throw new SearchRequestError(`OpenAI search failed (HTTP ${response.status}).`, payload);
  }
  return payload;
}

export async function searchAndSaveCompanyWebsites(
  investorId: string,
  dependencies: { store: SearchStore; request: (investor: InvestorIdentity, model: string) => Promise<unknown>; model?: string }
): Promise<SearchView> {
  const { store, request } = dependencies;
  const investor = await store.findInvestor(investorId);
  if (!investor) throw new InvestorNotFound("Investor not found.");
  const model = dependencies.model?.trim() || DEFAULT_MODEL;
  const search = await store.start(investor, model, new Date(Date.now() + SEARCH_LIFETIME_MS));
  let response: unknown;
  try {
    response = await request(investor, model);
    const result = parseSearchResponse(response, investor);
    // Return only the committed database result. No scraper or indexer runs here.
    return await store.complete(search.id, result, response);
  } catch (error) {
    const message = error instanceof SearchRequestError ? error.message :
      error instanceof Error && error.name === "TimeoutError" ? "OpenAI search timed out. Please start a new search." :
      "Search interrupted or its results could not be saved. Please run a new search.";
    await store.fail(search.id, message, response ?? (error instanceof SearchRequestError ? error.response : undefined));
    throw error;
  }
}
