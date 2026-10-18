import { NextResponse } from "next/server";
import { vcDiscoverySummary } from "@/lib/vc-discovery";

export const runtime="nodejs";

export async function GET() {
  try { return NextResponse.json(await vcDiscoverySummary()); }
  catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Database unavailable."},{status:503}); }
}
