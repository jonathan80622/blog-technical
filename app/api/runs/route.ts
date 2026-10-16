import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const runtime="nodejs";
export async function GET() { try { return NextResponse.json(await db.job.findMany({orderBy:{updatedAt:"desc"},take:20,include:{attemptsLog:{orderBy:{startedAt:"desc"},take:1}}})); } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Database unavailable."},{status:503}); } }
