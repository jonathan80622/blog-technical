import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const file=process.argv[2]??"data/market-map-2026-10-17.json";
const batch=JSON.parse(await readFile(file,"utf8"));
const db=new PrismaClient();
let created=0, alreadyQueued=0;
try {
  for(const [region,names] of Object.entries(batch.regions)) for(const name of names){
    const key=`source-fetch:${batch.batchId}:${createHash("sha256").update(name.normalize("NFKC").toLowerCase()).digest("hex").slice(0,20)}`;
    const added=await db.$transaction(async tx=>{
      await tx.investor.upsert({where:{name},update:{},create:{name,rationale:`Candidate from ${batch.batchId}; no fact is promoted until official-source collection validates it.`}});
      if(await tx.job.findUnique({where:{deduplicationKey:key},select:{id:true}})) return false;
      const requestedSources=["official_site","portfolio","technical_blog"];
      const job=await tx.job.create({data:{type:"FETCH_FIRM_SOURCES",deduplicationKey:key,state:"PENDING",progress:"Queued to fetch official firm sources",payload:{batchId:batch.batchId,status:batch.status,name,region,requestedSources}}});
      await tx.outbox.create({data:{jobId:job.id,topic:"source-fetch.requested",payload:{jobId:job.id,batchId:batch.batchId,name,region,requestedSources}}});
      return true;
    });
    added?created++:alreadyQueued++;
  }
  console.log(JSON.stringify({batchId:batch.batchId,created,alreadyQueued},null,2));
} finally { await db.$disconnect(); }
