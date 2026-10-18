import { db } from "@/lib/db";
import { extractPortfolioCompanies } from "@/lib/openai";

const hostname=(value:string) => {
  if(!value) return null;
  try {
    const url=new URL(value.includes("://")?value:`https://${value}`);
    return url.hostname.replace(/^www\./,"").toLowerCase();
  } catch { return null; }
};

const validCandidate=(candidate:{name:string;canonicalDomain:string;sourceUrl:string;passage:string},body:string,links:string[]) =>
  candidate.name.length>1&&candidate.name.length<=200&&candidate.passage.length>=8&&candidate.passage.length<=1_200&&body.includes(candidate.passage)&&links.includes(candidate.sourceUrl)&&hostname(candidate.sourceUrl)===hostname(candidate.canonicalDomain);

/** Promotes only entries with an exact passage from the stored portfolio document. */
export async function promotePortfolioCompanies(input:{investorId:string;investorName:string;portfolioUrl:string}) {
  const source=await db.source.findUniqueOrThrow({where:{url:input.portfolioUrl},select:{id:true}});
  const document=await db.document.findUniqueOrThrow({where:{canonicalUrl:input.portfolioUrl},include:{versions:{orderBy:{createdAt:"desc"},take:1}}});
  const version=document.versions[0];
  if(!version) throw new Error("The indexed portfolio source has no document version.");
  const links=Array.isArray(version.links)?version.links.filter((link):link is string=>typeof link==="string"):[];
  const extracted=await extractPortfolioCompanies(input.investorName,version.body,links);
  const unique=new Map<string,typeof extracted[number]>();
  for(const candidate of extracted) if(validCandidate(candidate,version.body,links)) unique.set(candidate.name.normalize("NFKC").toLocaleLowerCase(),candidate);
  let promoted=0;
  const companyIds:string[]=[];
  for(const candidate of unique.values()) {
    const domain=hostname(candidate.canonicalDomain);
    const company=await db.$transaction(async tx=>{
      let existing=await tx.company.findUnique({where:{name:candidate.name}});
      if(!existing&&domain) existing=await tx.company.findUnique({where:{canonicalDomain:domain}});
      if(existing) {
        if(!existing.canonicalDomain&&domain) return tx.company.update({where:{id:existing.id},data:{canonicalDomain:domain}});
        return existing;
      }
      return tx.company.create({data:{name:candidate.name,canonicalDomain:domain}});
    });
    await db.portfolioRelationship.upsert({where:{investorId_companyId_sourceId:{investorId:input.investorId,companyId:company.id,sourceId:source.id}},update:{},create:{investorId:input.investorId,companyId:company.id,sourceId:source.id}});
    await db.source.upsert({where:{url:candidate.sourceUrl},update:{companyId:company.id,type:"official_company_site"},create:{url:candidate.sourceUrl,companyId:company.id,type:"official_company_site",capabilities:["fetch","extract","index"],rationale:"Official company URL linked from a verified investor portfolio page.",refreshPolicy:"manual-review-first",allowedDomains:domain?[domain]:[]}});
    const predicate=`portfolio_membership:${input.investorId}`;
    const claim=await db.claim.findFirst({where:{companyId:company.id,predicate},select:{id:true}}) ?? await db.claim.create({data:{companyId:company.id,predicate,status:"ACCEPTED",reviewNote:"Automatic acceptance under explicit-portfolio-link-v1: exact listing passage plus matching official company link.",value:{investorId:input.investorId,sourceId:source.id,companyUrl:candidate.sourceUrl,policy:"explicit-portfolio-link-v1"}}});
    await db.claimEvidence.upsert({where:{claimId_documentVersionId_passage:{claimId:claim.id,documentVersionId:version.id,passage:candidate.passage}},update:{},create:{claimId:claim.id,documentVersionId:version.id,passage:candidate.passage}});
    for(const taskType of ["OFFICIAL_SITE","FUNDING_ROUNDS","TECHNICAL_SOURCES"]) await db.coverageCheck.upsert({where:{companyId_taskType:{companyId:company.id,taskType}},update:{},create:{companyId:company.id,taskType,scope:{companyUrl:candidate.sourceUrl,sourceId:source.id},outcome:"NOT_SEARCHED",reason:"Queued after verified portfolio promotion."}});
    promoted++;
    companyIds.push(company.id);
  }
  return {extracted:extracted.length,promoted,companyIds};
}
