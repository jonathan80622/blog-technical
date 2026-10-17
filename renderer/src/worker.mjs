import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { chromium } from "playwright";

const jobId=process.env.JOB_ID, token=process.env.RENDER_TOKEN, bucket=process.env.S3_SNAPSHOT_BUCKET;
const controlPlane=process.env.CONTROL_PLANE_BASE_URL?.replace(/\/$/,"");
if(!jobId||!token||!bucket||!controlPlane) throw new Error("JOB_ID, RENDER_TOKEN, S3_SNAPSHOT_BUCKET, and CONTROL_PLANE_BASE_URL are required.");
const s3=new S3Client({});
const hash=value=>createHash("sha256").update(value).digest("hex");
const privateAddress=value=>/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|fc|fd)/i.test(value);
const publicHost=async hostname=>hostname!=="localhost"&&!hostname.endsWith(".local")&&(await dns.lookup(hostname,{all:true})).every(x=>!privateAddress(x.address));
const allowed=(hostname,domains)=>domains.some(domain=>hostname===domain||hostname.endsWith("."+domain));
const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};

async function control(path,body) {
  const response=await fetch(controlPlane+path,{method:"POST",headers,body:JSON.stringify(body)});
  if(!response.ok) throw new Error(`Control plane rejected ${path}: ${response.status}`);
  return response.json();
}

async function main(){
  const command=await control("/api/internal/render/command",{jobId});
  const target=new URL(command.url), domains=command.allowedDomains;
  if(!allowed(target.hostname,domains)||!await publicHost(target.hostname)) throw new Error("Renderer command violates egress policy.");
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1200},userAgent:"VC-Intelligence evidence collector/1.0"});
    await page.route("**/*",async route=>{try{const url=new URL(route.request().url());return allowed(url.hostname,domains)&&await publicHost(url.hostname)?route.continue():route.abort()}catch{return route.abort()}});
    const response=await page.goto(target.toString(),{waitUntil:"domcontentloaded",timeout:60000});
    const trace=[];let previous="",stable=0;
    for(let step=0;step<20;step++){
      const state=await page.evaluate(()=>({height:document.documentElement.scrollHeight,text:document.body.innerText,cards:document.querySelectorAll("article,li,[role=listitem]").length,next:Array.from(document.querySelectorAll("a")).filter(a=>/next|older|more/i.test(a.textContent||"")).length}));
      const current=hash(state.text); trace.push({step,height:state.height,textLength:state.text.length,cardCount:state.cards,nextLinks:state.next,hash:current}); stable=current===previous?stable+1:0; previous=current;
      if(stable>=3) break;
      await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight)); await page.waitForTimeout(500);
    }
    const artifact={finalUrl:page.url(),status:response?.status()??null,trace,termination:stable>=3?"stable":"max_scroll_steps"};
    const put=(key,body,type)=>s3.send(new PutObjectCommand({Bucket:bucket,Key:command.artifactPrefix+key,Body:body,ContentType:type,ServerSideEncryption:"AES256"}));
    await Promise.all([put("rendered.html",await page.content(),"text/html"),put("rendered.txt",await page.locator("body").innerText(),"text/plain"),put("telemetry.json",JSON.stringify(artifact),"application/json")]);
    await control("/api/internal/render/callback",{jobId,artifactPrefix:command.artifactPrefix,finalUrl:artifact.finalUrl,statusCode:artifact.status,telemetry:artifact});
  } finally { await browser.close(); }
}
main().catch(async error=>{console.error(error);try{await control("/api/internal/render/callback",{jobId,artifactPrefix:`failed/${jobId}/`,telemetry:{error:error instanceof Error?error.message:"Renderer failed"},failed:true,error:error instanceof Error?error.message:"Renderer failed"})}catch{}process.exitCode=1});
