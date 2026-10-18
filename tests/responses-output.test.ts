import assert from "node:assert/strict";
import test from "node:test";
import { parsedResponseJson, responseDiagnostic, responseText } from "../lib/responses-output.ts";

test("decodes a raw Responses web-search message rather than assuming SDK output_text",()=>{
  const raw:Parameters<typeof responseText>[0]={status:"completed",output:[
    {type:"web_search_call"},
    {type:"message",content:[{type:"output_text",text:'{"officialUrl":"https://example.com","portfolioUrl":"https://example.com/portfolio","reason":"official site"}'}]}
  ]};
  assert.equal(raw.output_text,undefined);
  assert.equal(responseText(raw),'{"officialUrl":"https://example.com","portfolioUrl":"https://example.com/portfolio","reason":"official site"}');
  assert.deepEqual(parsedResponseJson(raw,"Official-site discovery"),{officialUrl:"https://example.com",portfolioUrl:"https://example.com/portfolio",reason:"official site"});
});

test("uses a top-level output_text only when supplied",()=>{
  assert.equal(responseText({output_text:"{\"ok\":true}"}),"{\"ok\":true}");
});

test("reports a provider diagnostic for tool-only or incomplete payloads",()=>{
  const raw={status:"incomplete",output:[{type:"web_search_call"}],incomplete_details:{reason:"max_output_tokens"}};
  assert.equal(responseText(raw),"");
  assert.equal(responseDiagnostic(raw),"status=incomplete, output=web_search_call, reason=max_output_tokens");
  assert.throws(()=>parsedResponseJson(raw,"Official-site discovery"),/status=incomplete, output=web_search_call, reason=max_output_tokens/);
});
