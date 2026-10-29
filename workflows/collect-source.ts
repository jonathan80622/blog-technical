async function collectAttempt(sourceRunId:string,maxAttempts:number){
  "use step";
  const [{ db }, { event }, { runResearch }, { hostnameMatchesDomain }, { promotePortfolioCompanies }, { extractStoredSource, enrichCompany }] = await Promise.all([
    import("@/lib/db"), import("@/lib/source-runs"), import("@/lib/research"), import("@/lib/safe-source-fetch"), import("@/lib/portfolio-promotion"), import("@/lib/company-enrichment"),
  ]);
  const sourceRun=await db.sourceRun.findUniqueOrThrow({where:{id:sourceRunId}});
  await db.sourceRun.update({where:{id:sourceRunId},data:{attempts:0}});
  await event(sourceRunId,"FETCHING","Fetching",`Fetching ${sourceRun.url} with a maximum of ${maxAttempts} direct fetch attempts.`,{requestedUrl:sourceRun.url,maxAttempts});
  const hostname=new URL(sourceRun.url).hostname;
  if(sourceRun.sourceKind==="VC_PORTFOLIO") {
    const investors=await db.investor.findMany({where:{canonicalDomain:{not:null}},select:{id:true,name:true,canonicalDomain:true}});
    const investor=investors.filter(i=>i.canonicalDomain&&hostnameMatchesDomain(hostname,i.canonicalDomain)).sort((a,b)=>(b.canonicalDomain?.length??0)-(a.canonicalDomain?.length??0))[0];
    if(!investor?.canonicalDomain)throw new Error("Portfolio source is not on a verified investor domain.");
    const fetched=await runResearch(sourceRun.url,sourceRun.sourceKind,undefined,{investorId:investor.id},{maxAttempts});
    await db.sourceRun.update({where:{id:sourceRunId},data:{attempts:fetched.fetchAttemptCount}});
    await db.source.update({where:{url:sourceRun.url},data:{type:"portfolio"}});
    await event(sourceRunId,"VALIDATING","Promoting portfolio evidence","Portfolio source indexed; validating exact company passages and official links.");
    const result=await promotePortfolioCompanies({investorId:investor.id,investorName:investor.name,portfolioUrl:sourceRun.url});
    for(const companyId of result.companyIds)await enrichCompany(companyId);
    await event(sourceRunId,"VALIDATING","Portfolio validated",`Promoted ${result.promoted} evidence-backed companies from ${result.extracted} candidates; ${result.identityUnverified} official identities remain unresolved.`);
    return fetched;
  }
  const companies=await db.company.findMany({where:{canonicalDomain:{not:null}},select:{id:true,canonicalDomain:true}});
  const company=companies.filter(c=>c.canonicalDomain&&hostnameMatchesDomain(hostname,c.canonicalDomain)).sort((a,b)=>(b.canonicalDomain?.length??0)-(a.canonicalDomain?.length??0))[0];
  const fetched=await runResearch(sourceRun.url,sourceRun.sourceKind,undefined,company?{companyId:company.id}:undefined,{maxAttempts});
  await db.sourceRun.update({where:{id:sourceRunId},data:{attempts:fetched.fetchAttemptCount}});
  if(sourceRun.sourceKind==="TECHNICAL_BLOG"||sourceRun.sourceKind==="HIRING_POSTING") {
    if(!company)throw new Error("Company identity unresolved; collected source cannot support startup AI claims.");
    const type=sourceRun.sourceKind==="HIRING_POSTING"?"hiring_posting":"technical_article";
    await db.source.update({where:{url:sourceRun.url},data:{type}});
    await extractStoredSource(company.id,sourceRun.url,type);
    const taskType=type==="hiring_posting"?"HIRING_SIGNALS":"TECHNICAL_SOURCES";
    await db.coverageCheck.upsert({where:{companyId_taskType:{companyId:company.id,taskType}},update:{outcome:"VERIFIED",reason:"Source indexed; extracted AI signals remain subject to review.",lastVerifiedAt:new Date()},create:{companyId:company.id,taskType,scope:{url:sourceRun.url},outcome:"VERIFIED",reason:"Source indexed; extracted AI signals remain subject to review.",lastVerifiedAt:new Date()}});
  }
  await event(sourceRunId,"VALIDATING","Validated","Snapshot indexed; validation decision recorded.");
  return fetched;
}

async function getSourceRun(sourceRunId:string){
  "use step";
  const { db } = await import("@/lib/db");
  return db.sourceRun.findUniqueOrThrow({where:{id:sourceRunId},select:{url:true,maxAttempts:true}});
}

async function record(sourceRunId:string,state:"VERIFIED"|"FAILED",stage:string,message:string,metadata?:object){
  "use step";
  const { event } = await import("@/lib/source-runs");
  await event(sourceRunId,state,stage,message,metadata);
}

async function recordFailure(sourceRunId:string, sourceUrl:string, message:string, details?:{fetchAttemptCount?:number;finalUrl?:string;fetchOutcome?:string;status?:number;requestedUrl?:string}) {
  "use step";
  const [{ db }, { event }] = await Promise.all([import("@/lib/db"), import("@/lib/source-runs")]);
  const current=await db.sourceRun.findUnique({where:{id:sourceRunId},select:{attempts:true}});
  const attemptCount=details?.fetchAttemptCount??current?.attempts??0;
  if(details?.fetchAttemptCount!==undefined)await db.sourceRun.update({where:{id:sourceRunId},data:{attempts:attemptCount}});
  await event(sourceRunId,"FAILED","Failed",message,{requestedUrl:details?.requestedUrl??sourceUrl,finalUrl:details?.finalUrl,attemptCount,outcome:details?.fetchOutcome??"collection_failed",httpStatus:details?.status});
}

export async function collectSource(sourceRunId:string){
  "use workflow";
  const sourceRun=await getSourceRun(sourceRunId);
  try {
    const fetched=await collectAttempt(sourceRunId,sourceRun.maxAttempts);
    await record(sourceRunId,"VERIFIED","Verified","Collection completed. Evidence remains subject to claim-level review.",{requestedUrl:fetched.requestedUrl,finalUrl:fetched.finalUrl,attemptCount:fetched.fetchAttemptCount,outcome:fetched.fetchOutcome,httpStatus:fetched.httpStatus});
    return {sourceRunId,state:"VERIFIED"};
  } catch(error) {
    const message=error instanceof Error?error.message:"Unknown collection error";
    const details=error&&typeof error==="object"?error as {fetchAttemptCount?:number;finalUrl?:string;fetchOutcome?:string;status?:number;requestedUrl?:string}:undefined;
    await recordFailure(sourceRunId,sourceRun.url,message,details);
    throw error;
  }
}
