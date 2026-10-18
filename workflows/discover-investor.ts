import { db } from "@/lib/db";
import { discoverOfficialPortfolio } from "@/lib/openai";
import { runResearch } from "@/lib/research";
import { promotePortfolioCompanies } from "@/lib/portfolio-promotion";
import { enrichCompany } from "@/lib/company-enrichment";

const officialUrl=(value:string,label:string) => {
  let url:URL;
  try { url=new URL(value); } catch { throw new Error(`${label} is not a URL.`); }
  if(url.protocol!=="https:") throw new Error(`${label} must use HTTPS.`);
  return url;
};

async function loadJob(jobId:string) {
  "use step";
  const job=await db.job.findUniqueOrThrow({where:{id:jobId}});
  const payload=job.payload as {name?:unknown}|null;
  if(typeof payload?.name!=="string"||!payload.name.trim()) throw new Error("VC discovery job has no investor name.");
  const investor=await db.investor.findUniqueOrThrow({where:{name:payload.name}});
  return {name:investor.name,investorId:investor.id};
}

async function findPortfolio(name:string) {
  "use step";
  const found=await discoverOfficialPortfolio(name);
  const official=officialUrl(found.officialUrl,"Official URL");
  const portfolio=officialUrl(found.portfolioUrl,"Portfolio URL");
  if(portfolio.hostname!==official.hostname && !portfolio.hostname.endsWith(`.${official.hostname}`)) throw new Error("Portfolio URL is not on the official investor domain.");
  return {portfolioUrl:portfolio.toString(),reason:found.reason};
}

async function collectPortfolio(jobId:string, investor:{name:string;investorId:string}, found:{portfolioUrl:string;reason:string}) {
  "use step";
  await db.job.update({where:{id:jobId},data:{progress:"Indexing verified official portfolio source"}});
  await runResearch(found.portfolioUrl,`${investor.name} portfolio — ${found.reason}`,undefined,{investorId:investor.investorId});
}

async function extractAndPromote(jobId:string,investor:{name:string;investorId:string},found:{portfolioUrl:string}) {
  "use step";
  await db.job.update({where:{id:jobId},data:{progress:"Extracting evidence-backed portfolio companies"}});
  return promotePortfolioCompanies({investorId:investor.investorId,investorName:investor.name,portfolioUrl:found.portfolioUrl});
}

async function enrichPromotedCompanies(jobId:string,companyIds:string[]) {
  "use step";
  await db.job.update({where:{id:jobId},data:{progress:"Collecting official company, funding, and technical sources"}});
  const results=[]; for(const companyId of companyIds) results.push(await enrichCompany(companyId)); return results;
}

async function finish(jobId:string,result:{extracted:number;promoted:number;companyIds:string[]}) {
  "use step";
  await db.job.update({where:{id:jobId},data:{state:"SUCCEEDED",leaseUntil:null,progress:`Portfolio source indexed; promoted ${result.promoted} evidence-backed companies from ${result.extracted} extracted candidates.`}});
}

async function fail(jobId:string,message:string) {
  "use step";
  await db.job.update({where:{id:jobId},data:{state:"FAILED",leaseUntil:null,progress:`Discovery failed: ${message}`}});
}

export async function discoverInvestorSources(jobId:string) {
  "use workflow";
  try {
    const investor=await loadJob(jobId);
    const found=await findPortfolio(investor.name);
    await collectPortfolio(jobId,investor,found);
    const result=await extractAndPromote(jobId,investor,found);
    await enrichPromotedCompanies(jobId,result.companyIds);
    await finish(jobId,result);
  } catch(error) {
    const message=error instanceof Error?error.message:"Unknown VC discovery failure";
    await fail(jobId,message);
    throw error;
  }
}
