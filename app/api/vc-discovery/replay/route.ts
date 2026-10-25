import { NextResponse } from "next/server";
import { requeueZeroPromotionVcDiscoveryJob } from "@/lib/vc-discovery";

export const runtime="nodejs";

/** Replays only completed runs that promoted no companies; dispatch remains explicit. */
export async function POST(request:Request) {
  const input=await request.json().catch(()=>null);
  if(!input||typeof input.jobId!=="string") return NextResponse.json({error:"jobId is required."},{status:400});
  try {
    const replayed=await requeueZeroPromotionVcDiscoveryJob(input.jobId);
    return replayed
      ? NextResponse.json({state:"PENDING",message:"Promotion replay prepared. Dispatch one VC to start it."})
      : NextResponse.json({error:"Only a completed zero-promotion VC job can be replayed."},{status:409});
  } catch { return NextResponse.json({error:"Replay service unavailable."},{status:503}); }
}
