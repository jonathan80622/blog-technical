async function loadJob(jobId:string) {
  "use step";
  const { db } = await import("@/lib/db");
  const job=await db.job.findUniqueOrThrow({where:{id:jobId}});
  const payload=job.payload as {name?:unknown}|null;
  if(typeof payload?.name!=="string"||!payload.name.trim()) throw new Error("VC discovery job has no investor name.");
  const investor=await db.investor.findUniqueOrThrow({where:{name:payload.name}});
  return {name:investor.name,investorId:investor.id};
}

async function findPortfolio(name:string) {
  "use step";
  const [{ discoverOfficialPortfolio }, { verifiedOfficialPortfolioUrls }] = await Promise.all([import("@/lib/openai"), import("@/lib/official-portfolio-url")]);
  const found=await discoverOfficialPortfolio(name);
  const { portfolio }=verifiedOfficialPortfolioUrls(found.officialUrl,found.portfolioUrl);
  return {portfolioUrl:portfolio.toString(),reason:found.reason};
}

async function collectPortfolio(jobId:string, investor:{name:string;investorId:string}, found:{portfolioUrl:string;reason:string}) {
  "use step";
  const [{ db }, { runResearch }, { unresolvedSourceReason }] = await Promise.all([import("@/lib/db"), import("@/lib/research"), import("@/lib/source-outcome")]);
  await db.job.update({where:{id:jobId},data:{progress:"Indexing verified official portfolio source"}});
  try {
    await runResearch(found.portfolioUrl,`${investor.name} portfolio — ${found.reason}`,undefined,{investorId:investor.investorId});
    await db.source.update({where:{url:found.portfolioUrl},data:{type:"portfolio"}});
    return {state:"INDEXED" as const};
  } catch(error) {
    const reason=unresolvedSourceReason(error);
    if(!reason) throw error;
    return {state:"SEARCHED_UNRESOLVED" as const,reason};
  }
}

async function extractAndPromote(jobId:string,investor:{name:string;investorId:string},found:{portfolioUrl:string}) {
  "use step";
  const [{ db }, { promotePortfolioCompanies }] = await Promise.all([import("@/lib/db"), import("@/lib/portfolio-promotion")]);
  await db.job.update({where:{id:jobId},data:{progress:"Extracting evidence-backed portfolio companies"}});
  return promotePortfolioCompanies({investorId:investor.investorId,investorName:investor.name,portfolioUrl:found.portfolioUrl});
}

async function enrichPromotedCompanies(jobId:string,companyIds:string[]) {
  "use step";
  const [{ db }, { enrichCompany }] = await Promise.all([import("@/lib/db"), import("@/lib/company-enrichment")]);
  await db.job.update({where:{id:jobId},data:{progress:"Collecting official company, funding, and technical sources"}});
  const results=[]; for(const companyId of companyIds) results.push(await enrichCompany(companyId)); return results;
}

async function finish(jobId:string,result:{extracted:number;promoted:number;companyIds:string[];rejected:Record<string,number>;identityUnverified:number}) {
  "use step";
  const { db } = await import("@/lib/db");
  const rejectionSummary=Object.entries(result.rejected).filter(([,count])=>count>0).map(([reason,count])=>`${reason}=${count}`).join(", ")||"none";
  await db.job.update({where:{id:jobId},data:{state:"SUCCEEDED",leaseUntil:null,progress:`Portfolio source indexed; promoted ${result.promoted} evidence-backed companies from ${result.extracted} extracted candidates. Rejected: ${rejectionSummary}. Official identity unresolved: ${result.identityUnverified}.`}});
}

async function finishUnresolved(jobId:string,reason:string) {
  "use step";
  const { db } = await import("@/lib/db");
  await db.job.update({where:{id:jobId},data:{state:"SUCCEEDED",leaseUntil:null,progress:`Portfolio source SEARCHED_UNRESOLVED: ${reason}. No extraction or promotion was attempted.`}});
}

async function fail(jobId:string,message:string) {
  "use step";
  const { db } = await import("@/lib/db");
  await db.job.update({where:{id:jobId},data:{state:"FAILED",leaseUntil:null,progress:`Discovery failed: ${message}`}});
}

export async function discoverInvestorSources(jobId:string) {
  "use workflow";
  try {
    const investor=await loadJob(jobId);
    const found=await findPortfolio(investor.name);
    const collected=await collectPortfolio(jobId,investor,found);
    if(collected.state==="SEARCHED_UNRESOLVED") { await finishUnresolved(jobId,collected.reason); return; }
    const result=await extractAndPromote(jobId,investor,found);
    await enrichPromotedCompanies(jobId,result.companyIds);
    await finish(jobId,result);
  } catch(error) {
    const message=error instanceof Error?error.message:"Unknown VC discovery failure";
    await fail(jobId,message);
    throw error;
  }
}
