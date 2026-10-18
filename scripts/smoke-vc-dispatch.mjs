const baseUrl=process.env.VC_E2E_BASE_URL?.replace(/\/$/,"");
if(!baseUrl)throw new Error("Set VC_E2E_BASE_URL to a deployed non-production test URL.");

const dispatch=await fetch(baseUrl+"/api/vc-discovery/dispatch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({limit:1})});
const dispatched=await dispatch.json();
if(!dispatch.ok||dispatched.state!=="QUEUED"||!Array.isArray(dispatched.jobIds)||dispatched.jobIds.length!==1)throw new Error("Dispatch smoke failed: "+JSON.stringify(dispatched));

const jobId=dispatched.jobIds[0];
const deadline=Date.now()+120_000;
let observed=[];
while(Date.now()<deadline){
  const response=await fetch(baseUrl+"/api/vc-discovery");
  const summary=await response.json();
  const job=summary.jobs?.find(item=>item.id===jobId);
  if(job){
    observed.push({state:job.state,attempts:job.attempts,progress:job.progress});
    if(job.attempts>=1&&(job.state==="RUNNING"||job.state==="SUCCEEDED"||job.state==="FAILED")){
      console.log(JSON.stringify({jobId,observed},null,2));
      process.exit(0);
    }
  }
  await new Promise(resolve=>setTimeout(resolve,3000));
}
throw new Error("Queue consumer never claimed dispatched job "+jobId+": "+JSON.stringify(observed));
