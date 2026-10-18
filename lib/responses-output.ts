export type OutputContent={type?:string;text?:string;refusal?:string};
export type OutputItem={type?:string;content?:OutputContent[]};
export type ResponsePayload={id?:string;status?:string;output_text?:string;output?:OutputItem[];incomplete_details?:{reason?:string}|null;error?:{message?:string}|null};

/** Decodes the REST wire payload, not an OpenAI SDK convenience object. */
export function responseText(payload:ResponsePayload){
  if(typeof payload.output_text==="string"&&payload.output_text.trim())return payload.output_text;
  return payload.output?.flatMap(item=>item.content??[]).filter(content=>content.type==="output_text").map(content=>content.text??"").join("").trim()??"";
}

export function responseDiagnostic(payload:ResponsePayload){
  const outputTypes=(payload.output??[]).map(item=>item.type??"unknown").join(",")||"none";
  const reason=payload.error?.message??payload.incomplete_details?.reason??"no provider reason";
  return "status="+(payload.status??"unknown")+", output="+outputTypes+", reason="+reason;
}

export function parsedResponseJson(payload:ResponsePayload,label:string){
  const value=responseText(payload);
  if(!value)throw new Error(label+" returned no output text: "+responseDiagnostic(payload));
  try{return JSON.parse(value) as unknown;}catch{throw new Error(label+" returned invalid JSON: "+responseDiagnostic(payload));}
}
