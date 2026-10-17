import { NextResponse } from "next/server";
import { recordRendererResult } from "@/lib/renderer-control-plane";

export const runtime="nodejs";
const token=(request:Request)=>request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
export async function POST(request:Request) {
  const value=token(request); const body=await request.json().catch(()=>null);
  if(!value||!body||typeof body.jobId!=="string"||typeof body.artifactPrefix!=="string") return NextResponse.json({error:"Unauthorized"},{status:401});
  const accepted=await recordRendererResult({...body,token:value});
  return accepted?NextResponse.json({ok:true}):NextResponse.json({error:"Invalid or expired renderer command"},{status:401});
}
