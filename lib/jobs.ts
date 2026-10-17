import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type CollectionPayload = { url:string; label?:string; sourceId?:string; companyId?:string };

export async function requestCollection(payload:CollectionPayload, ownerId?:string) {
  const normalizedUrl = new URL(payload.url).toString();
  const deduplicationKey = `fetch:${normalizedUrl}`;
  return db.$transaction(async tx => {
    const job = await tx.job.upsert({
      where:{deduplicationKey},
      update:{payload:payload as Prisma.InputJsonValue,state:"PENDING",progress:"Awaiting queue delivery"},
      create:{type:"FETCH_AND_INDEX",deduplicationKey,state:"PENDING",progress:"Awaiting queue delivery",payload:payload as Prisma.InputJsonValue}
    });
    const researchRequest=await tx.researchRequest.create({data:{ownerId,scope:{url:normalizedUrl},jobId:job.id}});
    await tx.outbox.create({data:{jobId:job.id,topic:"collection.requested",payload:{jobId:job.id,url:normalizedUrl}}});
    return {requestId:researchRequest.id,jobId:job.id,state:job.state};
  });
}
