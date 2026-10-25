import { extractStoredSource } from "@/lib/company-enrichment";
import { sleep } from "workflow";
import { db } from "@/lib/db";
import { event } from "@/lib/source-runs";
import { runResearch } from "@/lib/research";
import { hostnameMatchesDomain } from "@/lib/safe-source-fetch";
import { promotePortfolioCompanies } from "@/lib/portfolio-promotion";
import { enrichCompany } from "@/lib/company-enrichment";

async function collectAttempt(sourceRunId:string,attempt:number){
  "use step";
  const sourceRun=await db.sourceRun.findUniqueOrThrow({where:{id:sourceRunId}});
  await db.sourceRun.update({where:{id:sourceRunId},data:{attempts:attempt}});
  await event(sourceRunId,"FETCHING","Fetching",`Attempt ${attempt} of ${sourceRun.maxAttempts}: fetching ${sourceRun.url}.`);
  const hostname=new URL(sourceRun.url).hostname;
  if(sourceRun.sourceKind==="VC_PORTFOLIO") {
    const investors=await db.investor.findMany({where:{canonicalDomain:{not:null}},select:{id:true,name:true,canonicalDomain:true}});
    const investor=investors.filter(i=>i.canonicalDomain&&hostnameMatchesDomain(hostname,i.canonicalDomain)).sort((a,b)=>(b.canonicalDomain?.length??0)-(a.canonicalDomain?.length??0))[0];
    if(!investor?.canonicalDomain)throw new Error("Portfolio source is not on a verified investor domain.");
    await runResearch(sourceRun.url,sourceRun.sourceKind,undefined,{investorId:investor.id});
    await db.source.update({where:{url:sourceRun.url},data:{type:"portfolio"}});
    await event(sourceRunId,"VALIDATING","Promoting portfolio evidence","Portfolio source indexed; validating exact company passages and official links.");
    const result=await promotePortfolioCompanies({investorId:investor.id,investorName:investor.name,portfolioUrl:sourceRun.url});
    for(const companyId of result.companyIds)await enrichCompany(companyId);
    await event(sourceRunId,"VALIDATING","Portfolio validated",`Promoted ${result.promoted} evidence-backed companies from ${result.extracted} candidates; ${result.identityUnverified} official identities remain unresolved.`);
    return;
  }
  const companies=await db.company.findMany({where:{canonicalDomain:{not:null}},select:{id:true,canonicalDomain:true}});
  const company=companies.filter(c=>c.canonicalDomain&&hostnameMatchesDomain(hostname,c.canonicalDomain)).sort((a,b)=>(b.canonicalDomain?.length??0)-(a.canonicalDomain?.length??0))[0];
  await runResearch(sourceRun.url,sourceRun.sourceKind,undefined,company?{companyId:company.id}:undefined);
  if(sourceRun.sourceKind==="TECHNICAL_BLOG"||sourceRun.sourceKind==="HIRING_POSTING") {
    if(!company)throw new Error("Company identity unresolved; collected source cannot support startup AI claims.");
    const type=sourceRun.sourceKind==="HIRING_POSTING"?"hiring_posting":"technical_article";
    await db.source.update({where:{url:sourceRun.url},data:{type}});
    await extractStoredSource(company.id,sourceRun.url,type);
    const taskType=type==="hiring_posting"?"HIRING_SIGNALS":"TECHNICAL_SOURCES";
    await db.coverageCheck.upsert({where:{companyId_taskType:{companyId:company.id,taskType}},update:{outcome:"VERIFIED",reason:"Source indexed; extracted AI signals remain subject to review.",lastVerifiedAt:new Date()},create:{companyId:company.id,taskType,scope:{url:sourceRun.url},outcome:"VERIFIED",reason:"Source indexed; extracted AI signals remain subject to review.",lastVerifiedAt:new Date()}});
  }
  await event(sourceRunId,"VALIDATING","Validated","Snapshot indexed; validation decision recorded.");
}

async function getSourceRun(sourceRunId:string){
  "use step";
  return db.sourceRun.findUniqueOrThrow({where:{id:sourceRunId},select:{maxAttempts:true}});
}

async function record(sourceRunId:string,state:"RETRY_SCHEDULED"|"VERIFIED"|"FAILED",stage:string,message:string){
  "use step";
  await event(sourceRunId,state,stage,message);
}

export async function collectSource(sourceRunId:string){
  "use workflow";
  const sourceRun=await getSourceRun(sourceRunId);
  for(let attempt=1;attempt<=sourceRun.maxAttempts;attempt++){
    try {
      await collectAttempt(sourceRunId,attempt);
      await record(sourceRunId,"VERIFIED","Verified","Collection completed. Evidence remains subject to claim-level review.");
      return {sourceRunId,state:"VERIFIED"};
    } catch(error) {
      const message=error instanceof Error?error.message:"Unknown collection error";
      if(attempt===sourceRun.maxAttempts){await record(sourceRunId,"FAILED","Failed",`Retry budget exhausted: ${message}`);throw error;}
      await record(sourceRunId,"RETRY_SCHEDULED","Retry scheduled",`Attempt ${attempt} failed: ${message}. Retrying in 30 seconds.`);
      await sleep("30 seconds");
    }
  }
}
