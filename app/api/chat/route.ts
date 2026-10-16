import { NextResponse } from "next/server";
import { answer } from "@/lib/openai";
import { retrieve } from "@/lib/research";
export const runtime="nodejs"; export const maxDuration=60;
export async function POST(request:Request) { try { const {question}=await request.json(); if(typeof question!=="string"||!question.trim()) return NextResponse.json({error:"A question is required."},{status:400}); const passages=await retrieve(question); if(!passages.length) return NextResponse.json({answer:"No indexed research matches this question yet. Add a source and run research first.",passages:[]}); const context=passages.map((p,i)=>`[${i+1}] ${p.title ?? p.canonicalUrl}\n${p.text}`).join("\n\n"); return NextResponse.json({answer:await answer(question,context),passages}); } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Chat failed."},{status:500}); } }
