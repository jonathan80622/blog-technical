import { NextResponse } from "next/server";
import { InvestorNotFound, SearchRequestError, requestCompanyWebsites, searchAndSaveCompanyWebsites } from "@/features/company-url-search/core";
import { companyUrlSearchStore, readCompanyUrlSearches } from "@/features/company-url-search/repository";

export const runtime = "nodejs";
export const maxDuration = 180;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const investorId = new URL(request.url).searchParams.get("investorId") || undefined;
  try {
    return NextResponse.json(await readCompanyUrlSearches(investorId));
  } catch {
    return NextResponse.json({ error: "Company website searches could not be loaded. Check the database connection and migration." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  if (!input || typeof input.investorId !== "string" || !input.investorId.trim() || input.investorId.length > 100) {
    return NextResponse.json({ error: "Select an investor." }, { status: 400 });
  }
  try {
    const search = await searchAndSaveCompanyWebsites(input.investorId, {
      store: companyUrlSearchStore, request: requestCompanyWebsites,
      model: process.env.OPENAI_COMPANY_URL_MODEL
    });
    return NextResponse.json({ search });
  } catch (error) {
    if (error instanceof InvestorNotFound) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof SearchRequestError) return NextResponse.json({ error: error.message }, { status: 502 });
    if (error instanceof Error && error.name === "TimeoutError") return NextResponse.json({ error: "OpenAI search timed out. Please start a new search." }, { status: 504 });
    return NextResponse.json({ error: "Company websites could not be saved. Please retry or check the database connection." }, { status: 503 });
  }
}
