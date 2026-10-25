import { RequestError } from "./research-api.ts";
import { SourceRunState } from "@prisma/client";
import { db } from "@/lib/db";
import { hostnameMatchesDomain, resolvePublicAddress } from "@/lib/safe-source-fetch";

export const sourceKind=(url:string)=>/\/blog\/|\/posts?\//i.test(url)?"TECHNICAL_BLOG":"VC_PORTFOLIO";

export async function event(sourceRunId:string,state:SourceRunState,stage:string,message:string,metadata?:object){
  await db.$transaction([
    db.sourceRun.update({where:{id:sourceRunId},data:{state,stage,nextRetryAt:state==="RETRY_SCHEDULED"?new Date(Date.now()+30_000):null}}),
    db.sourceRunEvent.create({data:{sourceRunId,state,stage,message,metadata}})
  ]);
}

export async function createMonitoredRun(url:string,label?:string,kind?:string){
  const parsed=new URL(url);if(parsed.protocol!=="https:"||parsed.username||parsed.password)throw new RequestError("Use an HTTPS source URL without credentials.");
  if(parsed.port&&parsed.port!=="443")throw new RequestError("Use the standard HTTPS port.");
  try { await resolvePublicAddress(parsed.hostname); }
  catch(error) { throw new RequestError(error instanceof Error?error.message:"Source hostname is not publicly reachable."); }
  const normalized=parsed.toString();
  if(kind&&!['VC_PORTFOLIO','TECHNICAL_BLOG','HIRING_POSTING'].includes(kind))throw new RequestError("Invalid source kind.");
  const resolvedKind=kind??sourceKind(normalized);
  if(resolvedKind==="VC_PORTFOLIO") {
    const investors=await db.investor.findMany({where:{canonicalDomain:{not:null}},select:{canonicalDomain:true}});
    if(!investors.some(i=>i.canonicalDomain&&hostnameMatchesDomain(parsed.hostname,i.canonicalDomain)))throw new RequestError("This portfolio URL does not match a verified investor domain. Use the prepared VC discovery workflow to discover new investors.");
  } else {
    const companies=await db.company.findMany({where:{canonicalDomain:{not:null}},select:{canonicalDomain:true}});
    if(!companies.some(c=>c.canonicalDomain&&hostnameMatchesDomain(parsed.hostname,c.canonicalDomain)))throw new RequestError("First discover this company's official domain through a portfolio source. Company evidence must use that domain.");
  }
  return db.$transaction(async tx=>{
    const run=await tx.researchRun.create({data:{label:label??new URL(normalized).hostname}});
    const sourceRun=await tx.sourceRun.create({data:{researchRunId:run.id,url:normalized,sourceKind:resolvedKind}});
    await tx.sourceRunEvent.create({data:{sourceRunId:sourceRun.id,state:"QUEUED",stage:"Queued",message:"Accepted for durable collection."}});
    return {run,sourceRun};
  });
}
