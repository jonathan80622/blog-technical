import { createHash } from "crypto";

type ChoiceAnswer={name:string;type:"choice";choice:string;confidence?:number};
type RefusalAnswer={name:string;type:"refusal"};
type DecisionResponse={answers:Array<ChoiceAnswer|RefusalAnswer>};
export type SourceAssessment={
  adapterVerdict:"usable"|"requires_source_adapter"|"insufficient_content"|"unsafe_to_promote";
  renderingVerdict:"static_html_sufficient"|"needs_browser_render"|"access_or_challenge"|"indeterminate";
  completenessVerdict:"likely_complete"|"likely_paginated_or_infinite"|"indeterminate";
  confidence:number|null;
  inputHash:string;
};
const choices=(name:string,values:Array<[string,string]>)=>({type:"choice",name,instructions:"Choose only from the supplied values using observable evidence in the response. Do not infer facts absent from the response.",choices:values.map(([value,description])=>({value,description}))});
const answer=(answers:DecisionResponse["answers"],name:string,fallback:string)=>{const result=answers.find(item=>item.name===name);return result?.type==="choice"?result.choice:fallback};

export async function assessSourceResponse(raw:string,parsed:string,url:string):Promise<SourceAssessment>{
  const inputHash=createHash("sha256").update(raw).digest("hex");
  if(!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured for source assessment.");
  const sample=raw.slice(0,24_000);
  const response=await fetch("https://api.openai.com/v1/decisions",{
    method:"POST",
    headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:process.env.OPENAI_DECISIONS_MODEL??"gpt-6-luna",
      input:`URL: ${url}\n\nRAW HTML SAMPLE:\n${sample}\n\nPARSED TEXT SAMPLE:\n${parsed.slice(0,12_000)}`,
      questions:[
        choices("adapter_verdict",[
          ["usable","The response contains a coherent, extractable article or technical index body rather than mostly navigation, boilerplate, or an error."],
          ["requires_source_adapter","The response appears useful but its content structure needs a source-specific extractor or pagination logic."],
          ["insufficient_content","There is too little substantive content to evaluate safely."],
          ["unsafe_to_promote","The response is a login, challenge, error, placeholder, consent wall, or otherwise unsuitable for evidence extraction."]
        ]),
        choices("rendering_verdict",[
          ["static_html_sufficient","The raw HTML appears to contain the substantive body or index needed for this task."],
          ["needs_browser_render","The page appears to defer meaningful content to client-side rendering or progressive loading."],
          ["access_or_challenge","The response appears blocked by login, bot mitigation, or an access challenge."],
          ["indeterminate","The supplied response does not establish whether rendering is needed."]
        ]),
        choices("completeness_verdict",[
          ["likely_complete","The response itself gives evidence that this is a complete article or a bounded complete listing."],
          ["likely_paginated_or_infinite","The response indicates more entries are loaded by pagination, a next cursor, or infinite scroll."],
          ["indeterminate","Completeness cannot be established from this response."]
        ])
      ]
    })
  });
  if(!response.ok) throw new Error(`Decision request failed: ${await response.text()}`);
  const result=await response.json() as DecisionResponse;
  const confidence=result.answers.filter((x):x is ChoiceAnswer=>x.type==="choice").map(x=>x.confidence??0);
  return {
    adapterVerdict:answer(result.answers,"adapter_verdict","unsafe_to_promote") as SourceAssessment["adapterVerdict"],
    renderingVerdict:answer(result.answers,"rendering_verdict","indeterminate") as SourceAssessment["renderingVerdict"],
    completenessVerdict:answer(result.answers,"completeness_verdict","indeterminate") as SourceAssessment["completenessVerdict"],
    confidence:confidence.length?Math.min(...confidence):null,
    inputHash
  };
}
