import { handleCallback } from "@vercel/queue";
import { start } from "workflow/api";
import { claimVcDiscoveryJob, type VcDiscoveryMessage } from "@/lib/vc-discovery";
import { discoverInvestorSources } from "@/workflows/discover-investor";

export const runtime="nodejs";

const callback=handleCallback<VcDiscoveryMessage>(async message=>{
  if(!message?.jobId) throw new Error("VC discovery queue message has no jobId.");
  if(!await claimVcDiscoveryJob(message.jobId)) return;
  try {
    await start(discoverInvestorSources,[message.jobId]);
  } catch(error) {
    // Restore a safely retryable state if durable workflow creation itself fails.
    const { db }=await import("@/lib/db");
    await db.job.updateMany({where:{id:message.jobId,state:"RUNNING"},data:{state:"FAILED",leaseUntil:null,progress:"Workflow start failed; initiate again to retry."}});
    throw error;
  }
});

export async function POST(request:Request) { return callback(request); }
