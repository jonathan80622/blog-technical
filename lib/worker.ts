import { db } from "@/lib/db";
import { runResearch } from "@/lib/research";
import type { CollectionPayload } from "@/lib/jobs";

export async function processCollectionJob(jobId:string) {
  const job=await db.job.findUnique({where:{id:jobId}});
  if(!job) throw new Error(`Unknown job: ${jobId}`);
  if(job.state==="SUCCEEDED") return {id:job.id,state:job.state};
  const payload=job.payload as CollectionPayload | null;
  if(!payload?.url) throw new Error(`Job ${jobId} has no collection URL.`);
  return runResearch(payload.url,payload.label,job.id);
}
