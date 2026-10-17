import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

const hash = (value:string) => createHash("sha256").update(value).digest("hex");
const expiry = () => new Date(Date.now()+10*60_000);

export async function issueRendererCommand(jobId:string) {
  const job=await db.job.findUnique({where:{id:jobId}});
  const payload=job?.payload as {url?:string;sourceId?:string}|null;
  if(!job||!payload?.url||!payload.sourceId) throw new Error("A renderer command requires a persisted, source-backed job.");
  const source=await db.source.findUnique({where:{id:payload.sourceId},select:{allowedDomains:true}});
  if(!source?.allowedDomains.length) throw new Error("The source has no egress allowlist.");
  const token=randomBytes(32).toString("base64url");
  await db.job.update({where:{id:jobId},data:{rendererCommandHash:hash(token),rendererCommandExpiresAt:expiry(),state:"QUEUED",progress:"Queued for isolated browser rendering"}});
  return {jobId,token};
}

export async function redeemRendererCommand(jobId:string, token:string) {
  const job=await db.job.findFirst({where:{id:jobId,rendererCommandHash:hash(token),rendererCommandExpiresAt:{gt:new Date()}},select:{payload:true}});
  const payload=job?.payload as {url?:string;sourceId?:string}|null;
  if(!payload?.url||!payload.sourceId) return null;
  const source=await db.source.findUnique({where:{id:payload.sourceId},select:{allowedDomains:true}});
  if(!source?.allowedDomains.length) return null;
  return {url:payload.url,sourceId:payload.sourceId,allowedDomains:source.allowedDomains,artifactPrefix:`raw/${payload.sourceId}/${jobId}/`};
}

export async function recordRendererResult(input:{jobId:string;token:string;artifactPrefix:string;finalUrl?:string;statusCode?:number;telemetry:unknown;failed?:boolean;error?:string}) {
  const job=await db.job.findFirst({where:{id:input.jobId,rendererCommandHash:hash(input.token),rendererCommandExpiresAt:{gt:new Date()}},select:{id:true}});
  if(!job) return false;
  await db.$transaction([
    db.renderArtifact.upsert({where:{jobId_artifactPrefix:{jobId:input.jobId,artifactPrefix:input.artifactPrefix}},update:{finalUrl:input.finalUrl,statusCode:input.statusCode,telemetry:input.telemetry as never},create:{jobId:input.jobId,artifactPrefix:input.artifactPrefix,finalUrl:input.finalUrl,statusCode:input.statusCode,telemetry:input.telemetry as never}}),
    db.job.update({where:{id:input.jobId},data:input.failed?{state:"FAILED",progress:input.error??"Renderer failed"}:{state:"RUNNING",progress:"Rendered artifact ready for assessment",rendererCommandHash:null,rendererCommandExpiresAt:null}})
  ]);
  return true;
}
