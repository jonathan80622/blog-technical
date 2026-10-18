import { ClaimStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const statuses=new Set<ClaimStatus>(["CANDIDATE","ACCEPTED","REJECTED","CONFLICTING"]);

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const {status,reviewNote}=await request.json();
    if(!statuses.has(status)) return NextResponse.json({error:"Invalid claim status."},{status:400});
    if(typeof reviewNote!=="undefined"&&typeof reviewNote!=="string") return NextResponse.json({error:"reviewNote must be text."},{status:400});
    const id=(await params).id;
    const existing=await db.claim.findUniqueOrThrow({where:{id},select:{companyId:true,predicate:true,value:true}});
    const claim=await db.claim.update({where:{id},data:{status,reviewNote:reviewNote?.trim()||null}});
    if(existing.companyId&&existing.predicate.startsWith("portfolio_membership:")) {
      const value=existing.value as {investorId?:unknown;sourceId?:unknown};
      if(typeof value.investorId==="string"&&typeof value.sourceId==="string") {
        const where={investorId_companyId_sourceId:{investorId:value.investorId,companyId:existing.companyId,sourceId:value.sourceId}};
        if(status==="REJECTED") await db.portfolioRelationship.deleteMany({where:where.investorId_companyId_sourceId});
        if(status==="ACCEPTED") await db.portfolioRelationship.upsert({where,update:{},create:{investorId:value.investorId,companyId:existing.companyId,sourceId:value.sourceId}});
      }
    }
    return NextResponse.json(claim);
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Claim review failed."},{status:500}); }
}
