import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime="nodejs";

export async function GET() {
  try {
    const [investors,companies,coverage,claims]=await Promise.all([
      db.investor.findMany({orderBy:{name:"asc"},include:{sources:true,portfolioRelationships:{include:{company:true}}}}),
      db.company.findMany({orderBy:{name:"asc"},include:{fundingRounds:{include:{investors:{include:{investor:true}}}},coverageChecks:true,sources:true}}),
      db.coverageCheck.groupBy({by:["outcome"],_count:{_all:true}}),
      db.claim.findMany({orderBy:{updatedAt:"desc"},take:100,include:{company:true,evidence:{include:{documentVersion:{include:{document:true}}}}}})
    ]);
    return NextResponse.json({investors,companies,coverage,claims});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"Database unavailable."},{status:503});
  }
}
