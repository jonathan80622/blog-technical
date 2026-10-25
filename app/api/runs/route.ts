import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const runtime="nodejs";
export async function GET() {
  try {
    const runs=await db.researchRun.findMany({orderBy:{updatedAt:"desc"},take:20,include:{sourceRuns:{orderBy:{updatedAt:"desc"},include:{events:{orderBy:{createdAt:"desc"},take:8}}}}});
    return NextResponse.json(runs);
  } catch {
    return NextResponse.json({error:"Source run records unavailable."},{status:503});
  }
}
