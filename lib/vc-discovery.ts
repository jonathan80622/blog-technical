import { JobState } from "@prisma/client";
import { db } from "@/lib/db";

export const VC_DISCOVERY_TOPIC="vc-discovery.requested";

export type VcDiscoveryMessage={jobId:string};

/**
 * Queue delivery is at-least-once. This state transition makes accepting a
 * message idempotent; only the first delivery may start a workflow.
 */
export async function claimVcDiscoveryJob(jobId:string) {
  const claimed=await db.job.updateMany({
    where:{id:jobId,type:"FETCH_FIRM_SOURCES",state:"QUEUED"},
    data:{state:"RUNNING",attempts:{increment:1},leaseUntil:new Date(Date.now()+15*60_000),progress:"Starting VC source-discovery workflow"}
  });
  return claimed.count===1;
}

/**
 * The beta push-trigger schema has no documented concurrency control. Enforce
 * the application-level cap in Postgres instead.
 */
export async function leaseVcDiscoveryJobs(requested=5) {
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('vc-discovery-dispatch'))`;
    const active=await tx.job.count({where:{type:"FETCH_FIRM_SOURCES",state:{in:["QUEUED","RUNNING"]}}});
    const available=Math.max(0,5-active);
    const jobs=await tx.job.findMany({where:{type:"FETCH_FIRM_SOURCES",state:{in:["PENDING","FAILED"]}},orderBy:{createdAt:"asc"},take:Math.min(Math.max(1,requested),available),select:{id:true}});
    await Promise.all(jobs.map(job=>tx.job.update({where:{id:job.id},data:{state:"QUEUED",progress:"Queued for VC source discovery",leaseUntil:new Date(Date.now()+15*60_000)}})));
    return jobs;
  });
}

export async function returnVcDiscoveryJobToPending(jobId:string,error:string) {
  await db.$transaction([
    db.job.update({where:{id:jobId},data:{state:"PENDING",leaseUntil:null,progress:"Queue publication failed"}}),
    db.outbox.updateMany({where:{jobId,topic:"source-fetch.requested",deliveredAt:null},data:{deliveryAttempts:{increment:1},lastError:error}})
  ]);
}

export async function markVcDiscoveryDispatched(jobId:string) {
  await db.outbox.updateMany({where:{jobId,topic:"source-fetch.requested",deliveredAt:null},data:{deliveredAt:new Date(),deliveryAttempts:{increment:1},lastError:null}});
}

export async function vcDiscoverySummary() {
  const [counts,jobs]=await Promise.all([
    db.job.groupBy({by:["state"],where:{type:"FETCH_FIRM_SOURCES"},_count:{_all:true}}),
    db.job.findMany({where:{type:"FETCH_FIRM_SOURCES"},orderBy:{updatedAt:"desc"},take:8,select:{id:true,state:true,progress:true,attempts:true,updatedAt:true,payload:true}})
  ]);
  return {counts:Object.fromEntries(counts.map(x=>[x.state,x._count._all])) as Partial<Record<JobState,number>>,jobs};
}
