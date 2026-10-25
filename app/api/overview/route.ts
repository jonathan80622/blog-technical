import { NextResponse } from "next/server";
import { summarizeTrends } from "@/lib/ai-signals";
import { db } from "@/lib/db";

export const runtime="nodejs";

export async function GET() {
  try {
    const [investors,companies,coverage,claims,signals]=await Promise.all([
      db.investor.findMany({orderBy:{name:"asc"},include:{sources:true,portfolioRelationships:{include:{company:true}}}}),
      db.company.findMany({orderBy:{name:"asc"},include:{fundingRounds:{include:{investors:{include:{investor:true}}}},coverageChecks:true,sources:true}}),
      db.coverageCheck.groupBy({by:["outcome"],_count:{_all:true}}),
      db.claim.findMany({orderBy:{updatedAt:"desc"},take:100,include:{company:true,evidence:{include:{documentVersion:{include:{document:true}}}}}})
      ,db.claim.findMany({where:{predicate:"ai_signal",status:"ACCEPTED"},include:{company:true,evidence:{include:{documentVersion:{include:{document:true}}}}}})
    ]);
    return NextResponse.json({investors,companies,coverage,claims,trends:summarizeTrends(signals)});
  } catch {
    return NextResponse.json({error:"Research records unavailable."},{status:503});
  }
}
