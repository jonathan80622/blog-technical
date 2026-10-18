const key = process.env.OPENAI_API_KEY;
function headers() { if (!key) throw new Error("OPENAI_API_KEY is not configured."); return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }; }
export async function embed(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", { method:"POST", headers:headers(), body:JSON.stringify({ model:process.env.EMBEDDING_MODEL ?? "text-embedding-3-small", input:text }) });
  if (!response.ok) throw new Error(`Embedding request failed: ${await response.text()}`);
  const json = await response.json() as { data: Array<{ embedding:number[] }> };
  return json.data[0].embedding;
}
export async function answer(question:string, context:string) {
  const response = await fetch("https://api.openai.com/v1/responses", { method:"POST", headers:headers(), body:JSON.stringify({ model:process.env.OPENAI_CHAT_MODEL ?? "gpt-5-mini", instructions:"Answer only from the supplied research passages. State uncertainty when the passages do not establish an answer. Do not turn missing evidence into a negative claim. Cite passages as [1], [2], etc.", input:`Research passages:\n${context}\n\nQuestion: ${question}` }) });
  if (!response.ok) throw new Error(`Chat request failed: ${await response.text()}`);
  const json = await response.json() as { output_text?:string };
  return json.output_text ?? "The model returned no text.";
}

export type OfficialPortfolioDiscovery={officialUrl:string;portfolioUrl:string;reason:string};
export type PortfolioCompanyCandidate={name:string;canonicalDomain:string;sourceUrl:string;passage:string};
export type CompanyResearchSources={officialUrl:string;fundingUrls:string[];technicalUrls:string[]};
export type FundingCandidate={stage:string;announcedAt:string;amount:string;currency:string;investors:string[];passage:string};
export type ContributionCandidate={person:string;title:string;passage:string};

const parsedJson=(value:string) => {
  const fenced=value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
  return JSON.parse(fenced) as unknown;
};

/** Finds URLs only; the returned portfolio page is still fetched and assessed before use. */
export async function discoverOfficialPortfolio(investorName:string):Promise<OfficialPortfolioDiscovery> {
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:headers(),body:JSON.stringify({
    model:process.env.OPENAI_DISCOVERY_MODEL ?? "gpt-5.5",
    tools:[{type:"web_search"}],
    tool_choice:"required",
    instructions:"Research investor websites carefully. Return exactly one JSON object, with no markdown. Do not infer a URL. officialUrl must be the investor's official homepage and portfolioUrl must be a page on that same official domain which lists portfolio companies. If either cannot be established, return an empty string for it. reason must briefly identify the evidence used.",
    input:`Find the official homepage and official portfolio-companies page for this venture investor: ${investorName}.`
  })});
  if(!response.ok) throw new Error(`Official-site discovery failed: ${await response.text()}`);
  const json=await response.json() as {output_text?:string};
  if(!json.output_text) throw new Error("Official-site discovery returned no text.");
  const value=parsedJson(json.output_text);
  if(!value || typeof value!=="object") throw new Error("Official-site discovery returned invalid JSON.");
  const candidate=value as Partial<OfficialPortfolioDiscovery>;
  if(typeof candidate.officialUrl!=="string"||typeof candidate.portfolioUrl!=="string"||typeof candidate.reason!=="string") throw new Error("Official-site discovery returned an incomplete result.");
  return {officialUrl:candidate.officialUrl,portfolioUrl:candidate.portfolioUrl,reason:candidate.reason};
}

export async function extractPortfolioCompanies(investorName:string,body:string,links:string[]):Promise<PortfolioCompanyCandidate[]> {
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:headers(),body:JSON.stringify({
    model:process.env.OPENAI_EXTRACTION_MODEL ?? process.env.OPENAI_DISCOVERY_MODEL ?? "gpt-5.5",
    instructions:"Extract only companies explicitly listed as portfolio companies for the named investor in the supplied source text. Return exactly JSON with a `companies` array and no markdown. Each item must have `name`, `canonicalDomain`, `sourceUrl`, and `passage`. `passage` must be a short, exact, verbatim substring from the supplied text that establishes the portfolio listing. sourceUrl must be an exact URL from the supplied page-link list that is the company's official site; use empty strings when the page does not provide one. Exclude navigation brands, other investors, fund names, people, duplicate entries, and inferred companies.",
    input:`Investor: ${investorName}\n\nSource text:\n${body.slice(0,120_000)}\n\nPage links:\n${links.join("\n")}`
  })});
  if(!response.ok) throw new Error(`Portfolio extraction failed: ${await response.text()}`);
  const json=await response.json() as {output_text?:string};
  if(!json.output_text) throw new Error("Portfolio extraction returned no text.");
  const value=parsedJson(json.output_text);
  if(!value || typeof value!=="object"||!Array.isArray((value as {companies?:unknown}).companies)) throw new Error("Portfolio extraction returned invalid JSON.");
  return (value as {companies:unknown[]}).companies.flatMap(item=>{
    if(!item||typeof item!=="object") return [];
    const candidate=item as Partial<PortfolioCompanyCandidate>;
    return typeof candidate.name==="string"&&typeof candidate.canonicalDomain==="string"&&typeof candidate.sourceUrl==="string"&&typeof candidate.passage==="string"?[{name:candidate.name.trim(),canonicalDomain:candidate.canonicalDomain.trim(),sourceUrl:candidate.sourceUrl.trim(),passage:candidate.passage.trim()}]:[];
  });
}

export async function discoverCompanyResearchSources(name:string,domain:string):Promise<CompanyResearchSources> {
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:headers(),body:JSON.stringify({model:process.env.OPENAI_DISCOVERY_MODEL ?? "gpt-5.5",tools:[{type:"web_search"}],tool_choice:"required",instructions:"Return exactly JSON with officialUrl, fundingUrls, technicalUrls. Find only pages on the company's official domain. fundingUrls must be official announcements of Seed/Series rounds. technicalUrls must be engineering/technical articles that name an author. Return empty strings/arrays when unavailable; do not infer.",input:`Company: ${name}\nOfficial domain: ${domain}`} )});
  if(!response.ok) throw new Error(`Company source discovery failed: ${await response.text()}`);
  const output=await response.json() as {output_text?:string}; const value=parsedJson(output.output_text??"") as Partial<CompanyResearchSources>;
  return {officialUrl:typeof value.officialUrl==="string"?value.officialUrl:"",fundingUrls:Array.isArray(value.fundingUrls)?value.fundingUrls.filter((x):x is string=>typeof x==="string").slice(0,2):[],technicalUrls:Array.isArray(value.technicalUrls)?value.technicalUrls.filter((x):x is string=>typeof x==="string").slice(0,2):[]};
}

export async function extractFundingCandidates(body:string):Promise<FundingCandidate[]> { const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:headers(),body:JSON.stringify({model:process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5.5",instructions:"Return exactly JSON {rounds:[]}. Extract only announced funding rounds explicitly stated in the supplied document. Each item has stage, announcedAt ISO date or empty string, amount numeric string or empty string, currency ISO code or empty string, investors array, and passage as an exact short verbatim supporting substring. Do not infer missing values.",input:body.slice(0,120_000)})}); if(!response.ok) throw new Error(`Funding extraction failed: ${await response.text()}`); const data=parsedJson((await response.json() as {output_text?:string}).output_text??"") as {rounds?:unknown[]}; return Array.isArray(data.rounds)?data.rounds.flatMap(x=>{const v=x as Partial<FundingCandidate>;return typeof v?.stage==="string"&&typeof v.announcedAt==="string"&&typeof v.amount==="string"&&typeof v.currency==="string"&&Array.isArray(v.investors)&&typeof v.passage==="string"?[{stage:v.stage,announcedAt:v.announcedAt,amount:v.amount,currency:v.currency,investors:v.investors.filter((i):i is string=>typeof i==="string"),passage:v.passage}]:[]}):[]; }
export async function extractContributionCandidates(body:string):Promise<ContributionCandidate[]> { const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:headers(),body:JSON.stringify({model:process.env.OPENAI_EXTRACTION_MODEL ?? "gpt-5.5",instructions:"Return exactly JSON {contributors:[]}. Extract only named authors or engineers explicitly connected to the company and a demonstrated technical contribution in this document. Each item has person, title, and passage as a short exact verbatim supporting substring. Exclude inferred employment.",input:body.slice(0,120_000)})}); if(!response.ok) throw new Error(`Contribution extraction failed: ${await response.text()}`); const data=parsedJson((await response.json() as {output_text?:string}).output_text??"") as {contributors?:unknown[]}; return Array.isArray(data.contributors)?data.contributors.flatMap(x=>{const v=x as Partial<ContributionCandidate>;return typeof v?.person==="string"&&typeof v.title==="string"&&typeof v.passage==="string"?[{person:v.person.trim(),title:v.title.trim(),passage:v.passage.trim()}]:[]}):[]; }
