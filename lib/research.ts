import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { embed } from "@/lib/openai";
import { assessSourceResponse } from "@/lib/decisions";
import { UnresolvedSourceError } from "@/lib/source-outcome";
import { fetchPublicSource, SourceFetchError, SourceResponse } from "@/lib/safe-source-fetch";

export const configuredSources = [
  { name:"Lux portfolio", url:"https://www.luxcapital.com/companies", type:"portfolio" },
  { name:"Amplify Partners", url:"https://www.amplifypartners.com/", type:"portfolio" },
  { name:"Modal Series B", url:"https://modal.com/blog/announcing-our-series-b", type:"funding_announcement" },
  { name:"Modal Notebooks", url:"https://modal.com/blog/notebooks-internals", type:"technical_article" }
];
const clean = (html:string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const unescape=(value:string) => value.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
const meta=(html:string,names:string[]) => { for(const name of names) { const re=new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,`i`); const match=html.match(re); if(match?.[1]||match?.[2]) return unescape(match[1]??match[2]); } return null; };
const pageTitle=(html:string) => meta(html,["og:title","twitter:title"]) ?? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]) : null);
const pageDate=(html:string) => { const value=meta(html,["article:published_time","date","publishdate","datePublished"]); if(!value) return null; const date=new Date(value); return Number.isNaN(date.valueOf())?null:date; };
const pageLinks=(html:string,base:string) => [...new Set([...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#][^"']*)["']/gi)].flatMap(match=>{ try { const url=new URL(unescape(match[1]),base); return [url.protocol==="http:"||url.protocol==="https:"?url.toString():""]; } catch { return []; }}).filter(Boolean))].slice(0,5_000);
const chunks = (text:string) => { const size=1800, overlap=180; const result:string[]=[]; for(let i=0;i<text.length;i+=size-overlap) result.push(text.slice(i,i+size)); return result.filter(x=>x.length>120); };
type ResearchFetchOptions = { maxAttempts?:number };
const unresolvedOutcome = (error:unknown) => error instanceof UnresolvedSourceError ? error.reason : "processing_error";
const attemptCountOf = (error:unknown, response?:SourceResponse) => error instanceof SourceFetchError ? error.attemptCount : response?.attemptCount ?? 0;
export async function runResearch(url:string, label?:string, existingJobId?:string, context?:{investorId?:string;companyId?:string}, fetchOptions:ResearchFetchOptions={}) {
  new URL(url); const key=`fetch:${url}`; const job=existingJobId
    ? await db.job.update({where:{id:existingJobId},data:{state:"RUNNING",progress:"Fetching source",attempts:{increment:1},updatedAt:new Date()}})
    : await db.job.upsert({ where:{deduplicationKey:key}, update:{state:"RUNNING",progress:"Fetching source",attempts:{increment:1},updatedAt:new Date()}, create:{type:"FETCH_AND_INDEX",deduplicationKey:key,state:"RUNNING",progress:"Fetching source",attempts:1} });
  const jobAttempt=await db.jobAttempt.create({data:{jobId:job.id,state:"RUNNING",requestedUrl:url}});
  let fetched:SourceResponse|undefined;
  try {
    const source=await db.source.upsert({where:{url},update:{type:"official_page",...(context?.investorId?{investorId:context.investorId}:{}),...(context?.companyId?{companyId:context.companyId}:{})},create:{url,type:"official_page",capabilities:["fetch","extract","index"],rationale:label ?? "User-requested research source",...(context?.investorId?{investorId:context.investorId}:{}),...(context?.companyId?{companyId:context.companyId}:{})}});
    let allowedDomain=new URL(url).hostname;
    if(context?.companyId){const company=await db.company.findUnique({where:{id:context.companyId},select:{canonicalDomain:true}});if(company?.canonicalDomain)allowedDomain=company.canonicalDomain;}
    else if(context?.investorId){const investor=await db.investor.findUnique({where:{id:context.investorId},select:{canonicalDomain:true}});if(investor?.canonicalDomain)allowedDomain=investor.canonicalDomain;}
    const response=await fetchPublicSource(url,{allowedDomain,maxAttempts:fetchOptions.maxAttempts});
    fetched=response;
    await db.jobAttempt.update({where:{id:jobAttempt.id},data:{requestedUrl:url,finalUrl:response.finalUrl,httpStatus:response.status,attemptCount:response.attemptCount,fetchOutcome:response.outcome,fetchAttempts:response.attempts as Prisma.InputJsonValue}});
    if(!response.ok) throw new SourceFetchError(`Source returned HTTP ${response.status}.`,{requestedUrl:url,finalUrl:response.finalUrl,attempts:response.attempts,outcome:response.outcome,status:response.status});
    const raw=await response.text(), body=clean(raw);
    if(body.length<120){await db.jobAttempt.update({where:{id:jobAttempt.id},data:{fetchOutcome:"insufficient_content"}});throw new UnresolvedSourceError("insufficient_content","Source assessment: insufficient_content (parsed page body was too short to index).");}
    const title=pageTitle(raw); const publishedAt=pageDate(raw); const links=pageLinks(raw,response.finalUrl); await db.job.update({where:{id:job.id},data:{progress:"Checking source quality and loading behavior"}});
    const hash=createHash("sha256").update(body).digest("hex");
    const document=await db.document.upsert({where:{canonicalUrl:url},update:{title:title ?? label ?? new URL(url).hostname,publishedAt,fetchedAt:new Date(),statusCode:response.status,responseContentType:response.headers.get("content-type"),finalUrl:response.finalUrl},create:{sourceId:source.id,canonicalUrl:url,title:title ?? label ?? new URL(url).hostname,publishedAt,contentHash:hash,statusCode:response.status,responseContentType:response.headers.get("content-type"),finalUrl:response.finalUrl}});
    const assessment=await assessSourceResponse(raw,body,url);
    await db.documentAssessment.create({data:{documentId:document.id,model:process.env.OPENAI_DECISIONS_MODEL ?? "gpt-6-luna",adapterVerdict:assessment.adapterVerdict,renderingVerdict:assessment.renderingVerdict,completenessVerdict:assessment.completenessVerdict,confidence:assessment.confidence,inputHash:assessment.inputHash}});
    if(assessment.adapterVerdict==="unsafe_to_promote"||assessment.adapterVerdict==="insufficient_content"){await db.jobAttempt.update({where:{id:jobAttempt.id},data:{fetchOutcome:"insufficient_content"}});throw new UnresolvedSourceError("insufficient_content",`Source assessment: ${assessment.adapterVerdict}.`);}
    if(assessment.renderingVerdict==="access_or_challenge"){await db.jobAttempt.update({where:{id:jobAttempt.id},data:{fetchOutcome:"access_or_challenge"}});throw new UnresolvedSourceError("access_or_challenge","Source assessment: access or bot challenge detected.");}
    if(assessment.renderingVerdict==="needs_browser_render"){await db.jobAttempt.update({where:{id:jobAttempt.id},data:{fetchOutcome:"browser_render_required"}});throw new UnresolvedSourceError("browser_render_required","Source assessment: browser rendering is required before extraction.");}
    const previous=await db.documentVersion.findFirst({where:{documentId:document.id},orderBy:{createdAt:"desc"}});
    if(!previous || previous.body !== body || previous.rawHtml !== raw) {
      const version=await db.documentVersion.create({data:{documentId:document.id,body,rawHtml:raw,links,parserVersion:"html-provenance-v2"}});
      const pieces=chunks(body); for(let ordinal=0;ordinal<pieces.length;ordinal++) { await db.job.update({where:{id:job.id},data:{progress:`Embedding chunk ${ordinal+1} of ${pieces.length}`}}); const chunk=await db.documentChunk.create({data:{documentVersionId:version.id,ordinal,text:pieces[ordinal],embeddingModel:process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",embeddingVersion:"v1"}}); const vector=await embed(pieces[ordinal]); await db.$executeRaw`UPDATE "DocumentChunk" SET embedding = ${`[${vector.join(",")}]`}::vector WHERE id = ${chunk.id}`; }
    }
    await db.job.update({where:{id:job.id},data:{state:"SUCCEEDED",progress:"Indexed and ready for chat"}});
    await db.jobAttempt.update({where:{id:jobAttempt.id},data:{state:"SUCCEEDED",fetchOutcome:"success",finishedAt:new Date()}});
    return {id:job.id,state:"SUCCEEDED",fetchAttemptCount:response.attemptCount,requestedUrl:url,finalUrl:response.finalUrl,httpStatus:response.status,fetchOutcome:response.outcome};
  } catch(error) {
    const message=error instanceof Error?error.message:"Unknown research failure";
    const fetchError=error instanceof SourceFetchError?error:undefined;
    const attemptCount=attemptCountOf(error,fetched);
    const fetchOutcome=fetchError?.outcome??(fetched?unresolvedOutcome(error):"pre_fetch_failure");
    if(fetchError || fetched) {
      const attempts=fetchError?.attempts??fetched?.attempts??[];
      await db.jobAttempt.update({where:{id:jobAttempt.id},data:{requestedUrl:url,finalUrl:fetchError?.finalUrl??fetched?.finalUrl??null,httpStatus:fetchError?.status??fetched?.status??null,attemptCount,fetchOutcome,fetchAttempts:attempts as Prisma.InputJsonValue}});
    } else {
      await db.jobAttempt.update({where:{id:jobAttempt.id},data:{fetchOutcome:"pre_fetch_failure"}});
    }
    if(error && typeof error==="object") Object.assign(error,{fetchAttemptCount:attemptCount,finalUrl:fetchError?.finalUrl??fetched?.finalUrl,fetchOutcome});
    await db.job.update({where:{id:job.id},data:{state:"FAILED"}});
    await db.jobAttempt.update({where:{id:jobAttempt.id},data:{state:"FAILED",error:message,finishedAt:new Date()}});
    throw error;
  }
}
export async function retrieve(question:string) { const vector=await embed(question); return db.$queryRaw<Array<{id:string;text:string;title:string|null;canonicalUrl:string;similarity:number}>>`SELECT c.id,c.text,d.title,d."canonicalUrl",1 - (c.embedding <=> ${`[${vector.join(",")}]`}::vector) AS similarity FROM "DocumentChunk" c JOIN "DocumentVersion" v ON v.id=c."documentVersionId" JOIN "Document" d ON d.id=v."documentId" WHERE c.embedding IS NOT NULL ORDER BY c.embedding <=> ${`[${vector.join(",")}]`}::vector LIMIT 6`; }
