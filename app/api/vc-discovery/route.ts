import { NextResponse } from "next/server";
import { vcDiscoverySummary } from "@/lib/vc-discovery";

export const runtime="nodejs";

export async function GET() {
  try { return NextResponse.json(await vcDiscoverySummary()); }
  catch { return NextResponse.json({error:"VC discovery records unavailable."},{status:503}); }
}
