import { parsedResponseJson, responseDiagnostic, responseText, type ResponsePayload } from "./responses-output";

const key=process.env.OPENAI_API_KEY;

function headers(){if(!key)throw new Error("OPENAI_API_KEY is not configured.");return {Authorization:"Bearer "+key,"Content-Type":"application/json"};}

async function createResponse(body:Record<string,unknown>,label:string){
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:headers(),body:JSON.stringify(body)});
  if(!response.ok)throw new Error(label+" failed: "+await response.text());
  return await response.json() as ResponsePayload;
}

const officialPortfolioSchema={
  type:"object",additionalProperties:false,
  properties:{officialUrl:{type:"string"},portfolioUrl:{type:"string"},reason:{type:"string"}},
  required:["officialUrl","portfolioUrl","reason"]
};
const companyResearchSchema={
  type:"object",additionalProperties:false,
  properties:{officialUrl:{type:"string"},fundingUrls:{type:"array",items:{type:"string"}},technicalUrls:{type:"array",items:{type:"string"}}},
  required:["officialUrl","fundingUrls","technicalUrls"]
};
const portfolioCompaniesSchema={
  type:"object",additionalProperties:false,
  properties:{companies:{type:"array",items:{type:"object",additionalProperties:false,properties:{name:{type:"string"},canonicalDomain:{type:"string"},portfolioUrl:{type:"string"},officialUrl:{type:"string"},passage:{type:"string"}},required:["name","canonicalDomain","portfolioUrl","officialUrl","passage"]}}},
  required:["companies"]
};
const fundingSchema={
  type:"object",additionalProperties:false,
  properties:{rounds:{type:"array",items:{type:"object",additionalProperties:false,properties:{stage:{type:"string"},announcedAt:{type:"string"},amount:{type:"string"},currency:{type:"string"},investors:{type:"array",items:{type:"string"}},passage:{type:"string"}},required:["stage","announcedAt","amount","currency","investors","passage"]}}},
  required:["rounds"]
};
const contributionsSchema={
  type:"object",additionalProperties:false,
  properties:{contributors:{type:"array",items:{type:"object",additionalProperties:false,properties:{person:{type:"string"},title:{type:"string"},passage:{type:"string"}},required:["person","title","passage"]}}},
  required:["contributors"]
};

const structured=(name:string,schema:Record<string,unknown>)=>({format:{type:"json_schema",name,strict:true,schema}});

export async function embed(text:string):Promise<number[]>{
  const response=await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:headers(),body:JSON.stringify({model:process.env.EMBEDDING_MODEL??"text-embedding-3-small",input:text})});
  if(!response.ok)throw new Error("Embedding request failed: "+await response.text());
  const json=await response.json() as {data:Array<{embedding:number[]}>};
  return json.data[0].embedding;
}

export async function answer(question:string,context:string){
  const payload=await createResponse({model:process.env.OPENAI_CHAT_MODEL??"gpt-5-mini",instructions:"Answer only from the supplied research passages. State uncertainty when the passages do not establish an answer. Do not turn missing evidence into a negative claim. Cite passages as [1], [2], etc.",input:"Research passages:\n"+context+"\n\nQuestion: "+question},"Chat request");
  return responseText(payload)||"The model returned no text: "+responseDiagnostic(payload);
}

export type OfficialPortfolioDiscovery={officialUrl:string;portfolioUrl:string;reason:string};
export type PortfolioCompanyCandidate={name:string;canonicalDomain:string;portfolioUrl:string;officialUrl:string;passage:string};
export type CompanyResearchSources={officialUrl:string;fundingUrls:string[];technicalUrls:string[]};
export type FundingCandidate={stage:string;announcedAt:string;amount:string;currency:string;investors:string[];passage:string};
export type ContributionCandidate={person:string;title:string;passage:string};

/** Finds URLs only; the returned portfolio page is still fetched and assessed before use. */
export async function discoverOfficialPortfolio(investorName:string):Promise<OfficialPortfolioDiscovery>{
  const payload=await createResponse({
    model:process.env.OPENAI_DISCOVERY_MODEL??"gpt-5.5",
    tools:[{type:"web_search"}],tool_choice:"required",
    text:structured("official_portfolio",officialPortfolioSchema),
    instructions:"Find the investor's official homepage and a portfolio-companies page on the same official domain. Do not infer URLs. Return empty strings when a field cannot be established. The reason must identify the evidence used.",
    input:"Find the official homepage and official portfolio-companies page for this venture investor: "+investorName+"."
  },"Official-site discovery");
  const value=parsedResponseJson(payload,"Official-site discovery") as Partial<OfficialPortfolioDiscovery>;
  if(!value||typeof value!=="object"||typeof value.officialUrl!=="string"||typeof value.portfolioUrl!=="string"||typeof value.reason!=="string")throw new Error("Official-site discovery returned incomplete structured output: "+responseDiagnostic(payload));
  return {officialUrl:value.officialUrl,portfolioUrl:value.portfolioUrl,reason:value.reason};
}

export async function extractPortfolioCompanies(investorName:string,body:string,links:string[]):Promise<PortfolioCompanyCandidate[]>{
  const payload=await createResponse({
    model:process.env.OPENAI_EXTRACTION_MODEL??process.env.OPENAI_DISCOVERY_MODEL??"gpt-5.5",
    text:structured("portfolio_companies",portfolioCompaniesSchema),
    instructions:"Extract only companies explicitly listed as portfolio companies for the named investor in the supplied source text. passage must be a short exact substring from that text. portfolioUrl must be the exact corresponding URL from the supplied page-link list; it may be on the investor domain. officialUrl is optional: provide it only when it is also an exact page link and is on the company canonicalDomain; otherwise use empty strings for officialUrl and canonicalDomain. Exclude navigation brands, other investors, fund names, people, duplicates, and inferred companies.",
    input:"Investor: "+investorName+"\n\nSource text:\n"+body.slice(0,120_000)+"\n\nPage links:\n"+links.join("\n")
  },"Portfolio extraction");
  const value=parsedResponseJson(payload,"Portfolio extraction") as {companies?:unknown[]};
  return Array.isArray(value.companies)?value.companies.flatMap(item=>{const candidate=item as Partial<PortfolioCompanyCandidate>;return typeof candidate?.name==="string"&&typeof candidate.canonicalDomain==="string"&&typeof candidate.portfolioUrl==="string"&&typeof candidate.officialUrl==="string"&&typeof candidate.passage==="string"?[{name:candidate.name.trim(),canonicalDomain:candidate.canonicalDomain.trim(),portfolioUrl:candidate.portfolioUrl.trim(),officialUrl:candidate.officialUrl.trim(),passage:candidate.passage.trim()}]:[]}):[];
}

export async function discoverCompanyResearchSources(name:string,domain:string):Promise<CompanyResearchSources>{
  const payload=await createResponse({
    model:process.env.OPENAI_DISCOVERY_MODEL??"gpt-5.5",tools:[{type:"web_search"}],tool_choice:"required",text:structured("company_research_sources",companyResearchSchema),
    instructions:"Find only pages on the company's official domain. fundingUrls must be official announcements of Seed/Series rounds. technicalUrls must be engineering or technical articles that name an author. Return empty strings or arrays when unavailable; do not infer.",
    input:"Company: "+name+"\nOfficial domain: "+domain
  },"Company source discovery");
  const value=parsedResponseJson(payload,"Company source discovery") as Partial<CompanyResearchSources>;
  return {officialUrl:typeof value.officialUrl==="string"?value.officialUrl:"",fundingUrls:Array.isArray(value.fundingUrls)?value.fundingUrls.filter((x):x is string=>typeof x==="string").slice(0,2):[],technicalUrls:Array.isArray(value.technicalUrls)?value.technicalUrls.filter((x):x is string=>typeof x==="string").slice(0,2):[]};
}

export async function extractFundingCandidates(body:string):Promise<FundingCandidate[]>{
  const payload=await createResponse({model:process.env.OPENAI_EXTRACTION_MODEL??"gpt-5.5",text:structured("funding_rounds",fundingSchema),instructions:"Extract only announced funding rounds explicitly stated in the supplied document. passage must be an exact short verbatim supporting substring. Do not infer missing values.",input:body.slice(0,120_000)},"Funding extraction");
  const data=parsedResponseJson(payload,"Funding extraction") as {rounds?:unknown[]};
  return Array.isArray(data.rounds)?data.rounds.flatMap(x=>{const v=x as Partial<FundingCandidate>;return typeof v?.stage==="string"&&typeof v.announcedAt==="string"&&typeof v.amount==="string"&&typeof v.currency==="string"&&Array.isArray(v.investors)&&typeof v.passage==="string"?[{stage:v.stage,announcedAt:v.announcedAt,amount:v.amount,currency:v.currency,investors:v.investors.filter((i):i is string=>typeof i==="string"),passage:v.passage}]:[]}):[];
}

export async function extractContributionCandidates(body:string):Promise<ContributionCandidate[]>{
  const payload=await createResponse({model:process.env.OPENAI_EXTRACTION_MODEL??"gpt-5.5",text:structured("technical_contributors",contributionsSchema),instructions:"Extract only named authors or engineers explicitly connected to the company and a demonstrated technical contribution in this document. passage must be a short exact verbatim supporting substring. Exclude inferred employment.",input:body.slice(0,120_000)},"Contribution extraction");
  const data=parsedResponseJson(payload,"Contribution extraction") as {contributors?:unknown[]};
  return Array.isArray(data.contributors)?data.contributors.flatMap(x=>{const v=x as Partial<ContributionCandidate>;return typeof v?.person==="string"&&typeof v.title==="string"&&typeof v.passage==="string"?[{person:v.person.trim(),title:v.title.trim(),passage:v.passage.trim()}]:[]}):[];
}
