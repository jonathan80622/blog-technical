import { SourceRunState } from "@prisma/client";
import { db } from "@/lib/db";

export const sourceKind=(url:string)=>/\/blog\/|\/posts?\//i.test(url)?"TECHNICAL_BLOG":"VC_PORTFOLIO";

export async function event(sourceRunId:string,state:SourceRunState,stage:string,message:string,metadata?:object){
  await db.$transaction([
    db.sourceRun.update({where:{id:sourceRunId},data:{state,stage,nextRetryAt:state==="RETRY_SCHEDULED"?new Date(Date.now()+30_000):null}}),
    db.sourceRunEvent.create({data:{sourceRunId,state,stage,message,metadata}})
  ]);
}

export async function createMonitoredRun(url:string,label?:string){
  const normalized=new URL(url).toString();
  return db.$transaction(async tx=>{
    const run=await tx.researchRun.create({data:{label:label??new URL(normalized).hostname}});
    const sourceRun=await tx.sourceRun.create({data:{researchRunId:run.id,url:normalized,sourceKind:sourceKind(normalized)}});
    await tx.sourceRunEvent.create({data:{sourceRunId:sourceRun.id,state:"QUEUED",stage:"Queued",message:"Accepted for durable collection."}});
    return {run,sourceRun};
  });
}
