import type { Prisma } from "@prisma/client";
import { db } from "../../lib/db.ts";
import { SearchRequestError } from "./core.ts";
import type { SearchStore, SearchView, SearchState, CompanyWebsite } from "./core";

function view(row: Prisma.CompanyUrlSearchGetPayload<Record<string, never>>): SearchView {
  return {
    id: row.id, investorId: row.investorId, investorName: row.investorName,
    state: row.state as SearchState, links: row.links as unknown as CompanyWebsite[],
    resultCount: row.resultCount, rejectedCount: row.rejectedCount,
    notes: row.notes, error: row.error, createdAt: row.createdAt.toISOString()
  };
}

// The only shared domain dependency is a read of Investor identity. All writes
// belong to CompanyUrlSearch; this never creates Company/Source/Claim/Job rows.
export const companyUrlSearchStore: SearchStore = {
  findInvestor: id => db.investor.findUnique({ where: { id }, select: { id: true, name: true, canonicalDomain: true } }),
  start: (investor, model, expiresAt) => db.companyUrlSearch.create({
    data: { investorId: investor.id, investorName: investor.name, model, expiresAt }, select: { id: true }
  }),
  async complete(id, result, response) {
    // State, links, counts and raw provider output are one atomic row update.
    const saved = await db.companyUrlSearch.updateMany({
      where: { id, state: "SEARCHING", expiresAt: { gt: new Date() } },
      data: {
        state: result.links.length ? "SAVED" : "EMPTY", links: result.links,
        resultCount: result.links.length, rejectedCount: result.rejectedCount,
        notes: result.notes, responseId: result.responseId,
        response: response as Prisma.InputJsonValue, completedAt: new Date(), error: null
      }
    });
    if (saved.count !== 1) throw new SearchRequestError("Search expired before its results could be saved. Please run a new search.");
    return view(await db.companyUrlSearch.findUniqueOrThrow({ where: { id } }));
  },
  async fail(id, error, response) {
    await db.companyUrlSearch.updateMany({
      where: { id, state: "SEARCHING" },
      data: { state: "FAILED", error: error.slice(0, 2_000), completedAt: new Date(),
        ...(response === undefined ? {} : { response: response as Prisma.InputJsonValue }) }
    });
  }
};

export async function readCompanyUrlSearches(investorId?: string) {
  if (investorId) {
    // Recover interrupted HTTP requests; a late completion cannot overwrite this.
    await db.companyUrlSearch.updateMany({
      where: { investorId, state: "SEARCHING", expiresAt: { lte: new Date() } },
      data: { state: "FAILED", error: "Search did not finish before its deadline. Please run a new search.", completedAt: new Date() }
    });
  }
  const [investors, searches] = await Promise.all([
    db.investor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    investorId ? db.companyUrlSearch.findMany({ where: { investorId }, orderBy: { createdAt: "desc" }, take: 20 }) : Promise.resolve([])
  ]);
  return { investors, searches: searches.map(view) };
}
