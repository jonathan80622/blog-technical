import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { createMonitoredRun } from "@/lib/source-runs";
import { collectSource } from "@/workflows/collect-source";

export const runtime="nodejs";
export async function POST(request:Request) {
  try {
    const {url,label}=await request.json();
    if(typeof url!=="string") return NextResponse.json({error:"A source URL is required."},{status:400});
    const {run,sourceRun}=await createMonitoredRun(url,label);
    const workflow=await start(collectSource,[sourceRun.id]);
    await (await import("@/lib/db")).db.sourceRun.update({where:{id:sourceRun.id},data:{workflowRunId:workflow.runId}});
    return NextResponse.json({runId:run.id,sourceRunId:sourceRun.id,workflowRunId:workflow.runId,state:"QUEUED"},{status:202});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"Research request failed."},{status:500});
  }
}
