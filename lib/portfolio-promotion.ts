import { db } from "@/lib/db";
import { extractPortfolioCompanies } from "@/lib/openai";

const hostname=(value:string) => {
  if(!value) return null;
  try {
    const url=new URL(value.includes("://")?value:`https://${value}`);
    return url.hostname.replace(/^www\./,"").toLowerCase();
  } catch { return null; }
};

type Rejection="invalid_name"|"invalid_passage"|"passage_not_in_document"|"portfolio_url_not_linked";
const rejection=(candidate:{name:string;portfolioUrl:string;passage:string},body:string,links:string[]):Rejection|null => {
  if(candidate.name.length<=1||candidate.name.length>200)return "invalid_name";
  if(candidate.passage.length<8||candidate.passage.length>1_200)return "invalid_passage";
  if(!body.includes(candidate.passage))return "passage_not_in_document";
  if(!links.includes(candidate.portfolioUrl))return "portfolio_url_not_linked";
  return null;
};

const verifiedOfficialIdentity=(candidate:{canonicalDomain:string;officialUrl:string},links:string[]) => {
  const domain=hostname(candidate.canonicalDomain);
  if(!domain||!candidate.officialUrl||!links.includes(candidate.officialUrl)||hostname(candidate.officialUrl)!==domain) return null;
  return {domain,url:candidate.officialUrl};
};

/** Promotes only entries with an exact passage from the stored portfolio document. */
export async function promotePortfolioCompanies(input:{investorId:string;investorName:string;portfolioUrl:string}) {
  const source=await db.source.findUniqueOrThrow({where:{url:input.portfolioUrl},select:{id:true}});
  const document=await db.document.findUniqueOrThrow({where:{canonicalUrl:input.portfolioUrl},include:{versions:{orderBy:{createdAt:"desc"},take:1}}});
  const version=document.versions[0];
  if(!version) throw new Error("The indexed portfolio source has no document version.");
  const links=Array.isArray(version.links)?version.links.filter((link):link is string=>typeof link==="string"):[];
  const extracted=await extractPortfolioCompanies(input.investorName,version.body,links);
  const unique=new Map<string,typeof extracted[number]>();
  const rejected:Record<Rejection,number>={invalid_name:0,invalid_passage:0,passage_not_in_document:0,portfolio_url_not_linked:0};
  for(const candidate of extracted) {
    const reason=rejection(candidate,version.body,links);
    if(reason){rejected[reason]++;continue;}
    unique.set(candidate.name.normalize("NFKC").toLocaleLowerCase(),candidate);
  }
  let promoted=0;
  let identityUnverified=0;
  const companyIds:string[]=[];
  for(const candidate of unique.values()) {
    const official=verifiedOfficialIdentity(candidate,links);
    if(!official) identityUnverified++;
    const company=await db.$transaction(async tx=>{
      let existing=await tx.company.findUnique({where:{name:candidate.name}});
      if(!existing&&official) existing=await tx.company.findUnique({where:{canonicalDomain:official.domain}});
      if(existing) {
        if(!existing.canonicalDomain&&official) return tx.company.update({where:{id:existing.id},data:{canonicalDomain:official.domain}});
        return existing;
      }
      return tx.company.create({data:{name:candidate.name,canonicalDomain:official?.domain}});
    });
    await db.portfolioRelationship.upsert({where:{investorId_companyId_sourceId:{investorId:input.investorId,companyId:company.id,sourceId:source.id}},update:{},create:{investorId:input.investorId,companyId:company.id,sourceId:source.id}});
    await db.source.upsert({where:{url:candidate.portfolioUrl},update:{companyId:company.id,type:"portfolio_listing_link"},create:{url:candidate.portfolioUrl,companyId:company.id,type:"portfolio_listing_link",capabilities:["fetch","extract","index"],rationale:"Exact company-detail link from a verified investor portfolio page.",refreshPolicy:"manual-review-first",allowedDomains:[hostname(candidate.portfolioUrl)].filter((value):value is string=>Boolean(value))}});
    if(official) await db.source.upsert({where:{url:official.url},update:{companyId:company.id,type:"official_company_site"},create:{url:official.url,companyId:company.id,type:"official_company_site",capabilities:["fetch","extract","index"],rationale:"Official company URL linked from a verified investor portfolio page.",refreshPolicy:"manual-review-first",allowedDomains:[official.domain]}});
    const predicate=`portfolio_membership:${input.investorId}`;
    const claim=await db.claim.findFirst({where:{companyId:company.id,predicate},select:{id:true}}) ?? await db.claim.create({data:{companyId:company.id,predicate,status:"ACCEPTED",reviewNote:"Automatic acceptance under explicit-portfolio-link-v2: exact listing passage plus an exact portfolio-page link. Official company identity is recorded only when independently link-validated.",value:{investorId:input.investorId,sourceId:source.id,portfolioUrl:candidate.portfolioUrl,officialUrl:official?.url??null,policy:"explicit-portfolio-link-v2"}}});
    await db.claimEvidence.upsert({where:{claimId_documentVersionId_passage:{claimId:claim.id,documentVersionId:version.id,passage:candidate.passage}},update:{},create:{claimId:claim.id,documentVersionId:version.id,passage:candidate.passage}});
    for(const taskType of ["OFFICIAL_SITE","FUNDING_ROUNDS","TECHNICAL_SOURCES"]) await db.coverageCheck.upsert({where:{companyId_taskType:{companyId:company.id,taskType}},update:{},create:{companyId:company.id,taskType,scope:{portfolioUrl:candidate.portfolioUrl,officialUrl:official?.url??null,sourceId:source.id},outcome:"NOT_SEARCHED",reason:official?"Queued after verified portfolio promotion.":"Portfolio membership verified; official company identity is unresolved."}});
    promoted++;
    companyIds.push(company.id);
  }
  return {extracted:extracted.length,promoted,companyIds,rejected,identityUnverified};
}
