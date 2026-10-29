import { db } from "@/lib/db";
import { discoverCompanyResearchSources, extractContributionCandidates, extractFundingCandidates, extractAiSignals } from "@/lib/openai";
import { runResearch } from "@/lib/research";
import { sourceCoverageResult } from "@/lib/source-coverage";

const https=(value:string,domain:string) => { try { const url=new URL(value); return url.protocol==="https:"&&(url.hostname===domain||url.hostname.endsWith(`.${domain}`))?url.toString():null; } catch { return null; } };
const exact=(passage:string,body:string)=>passage.length>=8&&passage.length<=1_200&&body.includes(passage);

export async function extractStoredSource(companyId:string,url:string,type:string) {
  const source=await db.source.findUniqueOrThrow({where:{url}}); const document=await db.document.findUniqueOrThrow({where:{canonicalUrl:url},include:{versions:{orderBy:{createdAt:"desc"},take:1}}}); const version=document.versions[0]; if(!version) return {technicalEvidence:0}; let technicalEvidence=0;
  if(type==="hiring_posting"||type==="technical_article") {
    const kind=type==="hiring_posting"?"hiring_demand":"technical_use";
    for(const item of await extractAiSignals(version.body,kind)) {
      if(!exact(item.passage,version.body)) continue;
      if(kind==="technical_use") technicalEvidence++;
      // Stable identity makes workflow retries idempotent without resetting a review.
      const {createHash}=await import("node:crypto");
      const id="ai_"+createHash("sha256").update([companyId,version.id,kind,item.trend,item.passage].join("\n")).digest("hex");
      await db.claim.upsert({where:{id},update:{},create:{id,companyId,predicate:"ai_signal",value:{trend:item.trend,kind,sourceId:source.id},status:"CANDIDATE",evidence:{create:{documentVersionId:version.id,passage:item.passage}}}});
    }
  }
  if(type==="funding_announcement") for(const item of await extractFundingCandidates(version.body)) if(exact(item.passage,version.body)) {
    const date=item.announcedAt?new Date(item.announcedAt):null; const announcedAt=date&&!Number.isNaN(date.valueOf())?date:null; const amount=item.amount?Number(item.amount):null;
    const round=await db.fundingRound.findFirst({where:{companyId,stage:item.stage,announcedAt}}) ?? await db.fundingRound.create({data:{companyId,stage:item.stage,announcedAt,amount:Number.isFinite(amount)?amount:null,currency:item.currency||null,status:"CANDIDATE"}});
    const claim=await db.claim.create({data:{companyId,fundingRoundId:round.id,predicate:"funding_announcement",value:{investors:item.investors,sourceId:source.id},status:"CANDIDATE"}}); await db.claimEvidence.create({data:{claimId:claim.id,documentVersionId:version.id,passage:item.passage}});
    for(const name of item.investors) { const investor=await db.investor.findUnique({where:{name}}); if(investor) await db.roundInvestor.upsert({where:{fundingRoundId_investorId:{fundingRoundId:round.id,investorId:investor.id}},update:{sourceId:source.id},create:{fundingRoundId:round.id,investorId:investor.id,sourceId:source.id}}); }
  }
  if(type==="technical_article") for(const item of await extractContributionCandidates(version.body)) if(exact(item.passage,version.body)) {
    technicalEvidence++;
    const person=await db.person.findFirst({where:{name:item.person,canonicalUrl:null}}) ?? await db.person.create({data:{name:item.person}});
    await db.affiliation.upsert({where:{personId_companyId_sourceId_passage:{personId:person.id,companyId,sourceId:source.id,passage:item.passage}},update:{},create:{personId:person.id,companyId,sourceId:source.id,observedAt:document.publishedAt,passage:item.passage}});
    await db.contribution.upsert({where:{personId_sourceId_title_passage:{personId:person.id,sourceId:source.id,title:item.title,passage:item.passage}},update:{},create:{personId:person.id,companyId,sourceId:source.id,title:item.title,url, publishedAt:document.publishedAt,passage:item.passage}});
  }
  return {technicalEvidence};
}

const technicalCandidateRationale="Discovered URL is a candidate only; qualification requires exact technical evidence from its directly fetched page body.";

async function recordTechnicalSourceCandidate(companyId:string,url:string,domain:string) {
  await db.source.upsert({
    where:{url},
    update:{companyId,type:"technical_source_candidate",allowedDomains:[domain]},
    create:{url,companyId,type:"technical_source_candidate",capabilities:["fetch","extract","index"],rationale:technicalCandidateRationale,refreshPolicy:"manual-review-first",allowedDomains:[domain]}
  });
}

export async function enrichCompany(companyId:string) {
  const company=await db.company.findUniqueOrThrow({where:{id:companyId}});
  if(!company.canonicalDomain) return {companyId,official:false,funding:0,technical:0};
  const discovered=await discoverCompanyResearchSources(company.name,company.canonicalDomain);
  const tasks:["OFFICIAL_SITE"|"FUNDING_ROUNDS"|"TECHNICAL_SOURCES"|"HIRING_SIGNALS",string[],string][]=[
    ["OFFICIAL_SITE",[discovered.officialUrl],"official_company_site"],
    ["FUNDING_ROUNDS",discovered.fundingUrls,"funding_announcement"],
    ["TECHNICAL_SOURCES",discovered.technicalUrls,"technical_article"],
    ["HIRING_SIGNALS",discovered.hiringUrls,"hiring_posting"]
  ];
  const results:Record<string,number>={OFFICIAL_SITE:0,FUNDING_ROUNDS:0,TECHNICAL_SOURCES:0,HIRING_SIGNALS:0};
  const attempted:Record<string,number>={OFFICIAL_SITE:0,FUNDING_ROUNDS:0,TECHNICAL_SOURCES:0,HIRING_SIGNALS:0};
  const failures:Record<string,number>={OFFICIAL_SITE:0,FUNDING_ROUNDS:0,TECHNICAL_SOURCES:0,HIRING_SIGNALS:0};
  for(const [taskType] of tasks) await db.coverageCheck.upsert({where:{companyId_taskType:{companyId,taskType}},update:{},create:{companyId,taskType,scope:{domain:company.canonicalDomain},outcome:"NOT_SEARCHED"}});
  for(const [taskType,urls,type] of tasks) for(const candidate of urls) {
    const url=https(candidate,company.canonicalDomain); if(!url) continue;
    attempted[taskType]++;
    const isTechnicalCandidate=taskType==="TECHNICAL_SOURCES";
    try {
      if(isTechnicalCandidate) await recordTechnicalSourceCandidate(companyId,url,company.canonicalDomain);
      await runResearch(url,company.name+" "+type,undefined,{companyId});
      if(isTechnicalCandidate) await db.source.update({where:{url},data:{type:"technical_source_candidate"}});
      if(isTechnicalCandidate) {
        const extraction=await extractStoredSource(companyId,url,type);
        const qualified=extraction.technicalEvidence>0;
        await db.source.update({where:{url},data:{type:qualified?type:"technical_source_candidate"}});
        if(!qualified) continue;
      } else {
        await db.source.update({where:{url},data:{type}});
        if(type!=="official_company_site") await extractStoredSource(companyId,url,type);
      }
      results[taskType]++;
    } catch {
      if(isTechnicalCandidate) await db.source.update({where:{url},data:{type:"technical_source_candidate"}}).catch(()=>undefined);
      failures[taskType]++;
    }
  }
  for(const [taskType] of tasks) {
    const coverage=sourceCoverageResult(taskType,attempted[taskType],results[taskType],failures[taskType]);
    if(taskType==="TECHNICAL_SOURCES") coverage.reason="Directly fetched "+attempted[taskType]+" official-domain candidate(s); body-qualified "+results[taskType]+", unresolved "+(attempted[taskType]-results[taskType]-failures[taskType])+", failed "+failures[taskType]+".";
    await db.coverageCheck.update({where:{companyId_taskType:{companyId,taskType}},data:{...coverage,lastVerifiedAt:new Date()}});
  }
  return {companyId,official:results.OFFICIAL_SITE>0,funding:results.FUNDING_ROUNDS,technical:results.TECHNICAL_SOURCES,hiring:results.HIRING_SIGNALS};
}
