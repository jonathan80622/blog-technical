import { sleep } from "workflow";
import { db } from "@/lib/db";
import { event } from "@/lib/source-runs";
import { runResearch } from "@/lib/research";

async function collectAttempt(sourceRunId:string,attempt:number){
  "use step";
  const sourceRun=await db.sourceRun.findUniqueOrThrow({where:{id:sourceRunId}});
  await db.sourceRun.update({where:{id:sourceRunId},data:{attempts:attempt}});
  await event(sourceRunId,"FETCHING","Fetching",`Attempt ${attempt} of ${sourceRun.maxAttempts}: fetching ${sourceRun.url}.`);
  await runResearch(sourceRun.url,sourceRun.sourceKind);
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
