import { createHash, randomUUID } from "crypto";
import { db } from "@/lib/db";
import { embed } from "@/lib/openai";

export const configuredSources = [
  { name:"Lux portfolio", url:"https://www.luxcapital.com/companies", type:"portfolio" },
  { name:"Amplify Partners", url:"https://www.amplifypartners.com/", type:"portfolio" },
  { name:"Modal Series B", url:"https://modal.com/blog/announcing-our-series-b", type:"funding_announcement" },
  { name:"Modal Notebooks", url:"https://modal.com/blog/notebooks-internals", type:"technical_article" }
];
const clean = (html:string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const chunks = (text:string) => { const size=1800, overlap=180; const result:string[]=[]; for(let i=0;i<text.length;i+=size-overlap) result.push(text.slice(i,i+size)); return result.filter(x=>x.length>120); };
export async function runResearch(url:string, label?:string) {
  new URL(url); const key=`fetch:${url}`; const job=await db.job.upsert({ where:{deduplicationKey:key}, update:{state:"RUNNING",progress:"Fetching source",attempts:{increment:1},updatedAt:new Date()}, create:{type:"FETCH_AND_INDEX",deduplicationKey:key,state:"RUNNING",progress:"Fetching source",attempts:1} });
  await db.jobAttempt.create({data:{jobId:job.id,state:"RUNNING"}});
  try {
    const source=await db.source.upsert({where:{url},update:{type:"official_page"},create:{url,type:"official_page",capabilities:["fetch","extract","index"],rationale:label ?? "User-requested research source"}});
    const response=await fetch(url,{headers:{"User-Agent":"VC-Intelligence research pilot (+human-reviewed)"},signal:AbortSignal.timeout(25_000)});
    if(!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const raw=await response.text(), body=clean(raw); if(body.length<120) throw new Error("Parsed page body was too short to index."); await db.job.update({where:{id:job.id},data:{progress:"Extracted source body"}});
    const hash=createHash("sha256").update(body).digest("hex");
    const document=await db.document.upsert({where:{canonicalUrl:url},update:{title:label ?? new URL(url).hostname,fetchedAt:new Date(),contentHash:hash},create:{sourceId:source.id,canonicalUrl:url,title:label ?? new URL(url).hostname,contentHash:hash}});
    const previous=await db.documentVersion.findFirst({where:{documentId:document.id},orderBy:{createdAt:"desc"}});
    if(!previous || previous.body !== body) {
      const version=await db.documentVersion.create({data:{documentId:document.id,body,parserVersion:"html-text-v1"}});
      const pieces=chunks(body); for(let ordinal=0;ordinal<pieces.length;ordinal++) { await db.job.update({where:{id:job.id},data:{progress:`Embedding chunk ${ordinal+1} of ${pieces.length}`}}); const chunk=await db.documentChunk.create({data:{documentVersionId:version.id,ordinal,text:pieces[ordinal],embeddingModel:process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",embeddingVersion:"v1"}}); const vector=await embed(pieces[ordinal]); await db.$executeRaw`UPDATE "DocumentChunk" SET embedding = ${`[${vector.join(",")}]`}::vector WHERE id = ${chunk.id}`; }
    }
    await db.job.update({where:{id:job.id},data:{state:"SUCCEEDED",progress:"Indexed and ready for chat"}}); await db.jobAttempt.updateMany({where:{jobId:job.id,state:"RUNNING"},data:{state:"SUCCEEDED",finishedAt:new Date()}}); return {id:job.id,state:"SUCCEEDED"};
  } catch(error) { const message=error instanceof Error?error.message:"Unknown research failure"; await db.job.update({where:{id:job.id},data:{state:"FAILED"}}); await db.jobAttempt.updateMany({where:{jobId:job.id,state:"RUNNING"},data:{state:"FAILED",error:message,finishedAt:new Date()}}); throw error; }
}
export async function retrieve(question:string) { const vector=await embed(question); return db.$queryRaw<Array<{id:string;text:string;title:string|null;canonicalUrl:string;similarity:number}>>`SELECT c.id,c.text,d.title,d."canonicalUrl",1 - (c.embedding <=> ${`[${vector.join(",")}]`}::vector) AS similarity FROM "DocumentChunk" c JOIN "DocumentVersion" v ON v.id=c."documentVersionId" JOIN "Document" d ON d.id=v."documentId" WHERE c.embedding IS NOT NULL ORDER BY c.embedding <=> ${`[${vector.join(",")}]`}::vector LIMIT 6`; }
