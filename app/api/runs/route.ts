import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const runtime="nodejs";
export async function GET() {
  try {
    const runs=await db.researchRun.findMany({orderBy:{updatedAt:"desc"},take:20,include:{sourceRuns:{orderBy:{updatedAt:"desc"},include:{events:{orderBy:{createdAt:"desc"},take:8}}}}});
    return NextResponse.json(runs);
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"Database unavailable."},{status:503});
  }
}
