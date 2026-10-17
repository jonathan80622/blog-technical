import { NextResponse } from "next/server";
import { redeemRendererCommand } from "@/lib/renderer-control-plane";

export const runtime="nodejs";
const token=(request:Request)=>request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
export async function POST(request:Request) {
  const value=token(request); const {jobId}=await request.json().catch(()=>({}));
  if(!value||typeof jobId!=="string") return NextResponse.json({error:"Unauthorized"},{status:401});
  const command=await redeemRendererCommand(jobId,value);
  return command?NextResponse.json(command):NextResponse.json({error:"Invalid or expired renderer command"},{status:401});
}
