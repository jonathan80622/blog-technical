import { NextResponse } from "next/server";
import { send } from "@vercel/queue";
import { VC_DISCOVERY_TOPIC, leaseVcDiscoveryJobs, markVcDiscoveryDispatched, returnVcDiscoveryJobToPending } from "@/lib/vc-discovery";

export const runtime="nodejs";

export async function POST(request:Request) {
  const input=await request.json().catch(()=>({})); const requested=input?.limit===1?1:5;
  const jobs=await leaseVcDiscoveryJobs(requested);
  if(!jobs.length) return NextResponse.json({state:"IDLE",message:"No VC capacity is available; up to five discoveries can run at once."});
  const sent:string[]=[]; const failures:string[]=[];
  for(const job of jobs) try { await send(VC_DISCOVERY_TOPIC,{jobId:job.id},{idempotencyKey:`vc-discovery:${job.id}`,retentionSeconds:86_400}); await markVcDiscoveryDispatched(job.id); sent.push(job.id); }
  catch(error) { const message=error instanceof Error?error.message:"Queue publication failed."; await returnVcDiscoveryJobToPending(job.id,message); failures.push(message); }
  return NextResponse.json({state:sent.length?"QUEUED":"FAILED",jobIds:sent,requested,failures},{status:sent.length?202:503});
}
