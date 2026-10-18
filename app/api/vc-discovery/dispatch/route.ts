import { NextResponse } from "next/server";
import { send } from "@vercel/queue";
import { VC_DISCOVERY_TOPIC, leaseVcDiscoveryJobs, markVcDiscoveryDispatched, returnVcDiscoveryJobToPending, vcDiscoverySummary } from "@/lib/vc-discovery";

export const runtime="nodejs";

export async function POST(request:Request) {
  const input=await request.json().catch(()=>({})); const requested=input?.limit===1?1:5;
  const jobs=await leaseVcDiscoveryJobs(requested);
  if(!jobs.length) {
    const summary=await vcDiscoverySummary();
    const pending=(summary.counts.PENDING||0)+(summary.counts.FAILED||0);
    const active=(summary.counts.QUEUED||0)+(summary.counts.RUNNING||0);
    const message=pending
      ? `VC jobs are waiting but all ${summary.maxActive} discovery slot${summary.maxActive===1?" is":"s are"} active. Try again after one completes.`
      : active
        ? "All available VC discovery work is already in progress."
        : "No market-map jobs are prepared. Prepare candidates through the explicit market-map batch before dispatching them.";
    return NextResponse.json({state:"IDLE",message});
  }
  const sent:string[]=[]; const failures:string[]=[];
  for(const job of jobs) try { await send(VC_DISCOVERY_TOPIC,{jobId:job.id},{idempotencyKey:`vc-discovery:${job.id}`,retentionSeconds:86_400}); await markVcDiscoveryDispatched(job.id); sent.push(job.id); }
  catch(error) { const message=error instanceof Error?error.message:"Queue publication failed."; await returnVcDiscoveryJobToPending(job.id,message); failures.push(message); }
  return NextResponse.json({state:sent.length?"QUEUED":"FAILED",jobIds:sent,requested,failures,message:sent.length?undefined:(failures[0]||"Queue publication failed.")},{status:sent.length?202:503});
}
