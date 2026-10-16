import { NextResponse } from "next/server";
import { runResearch } from "@/lib/research";
export const runtime = "nodejs"; export const maxDuration = 60;
export async function POST(request:Request) { try { const {url,label}=await request.json(); if(typeof url!=="string") return NextResponse.json({error:"A source URL is required."},{status:400}); return NextResponse.json(await runResearch(url,label)); } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Research failed."},{status:500}); } }
