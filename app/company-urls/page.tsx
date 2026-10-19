import CompanyUrlSearch from "@/features/company-url-search/CompanyUrlSearch";

export default async function CompanyUrlsPage({ searchParams }: { searchParams: Promise<{ investorId?: string }> }) {
  const params = await searchParams;
  return <CompanyUrlSearch initialInvestorId={typeof params.investorId === "string" ? params.investorId : ""} />;
}
