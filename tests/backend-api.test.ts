import test from 'node:test';
import assert from 'node:assert/strict';
import { researchHandler, RequestError } from '../lib/research-api.ts';
import { claimReviewHandler, ReviewError, validateAiAcceptance } from '../lib/claim-review.ts';
const request = (body: unknown) => new Request('http://localhost/api/research', {method: 'POST', body: JSON.stringify(body)});
function harness(fail?: string) {
  const calls: string[] = [];
  const handler = researchHandler({
    create: async () => { calls.push('create'); if (fail === 'identity') throw new RequestError('Unknown company'); return {run: {id: 'r'}, sourceRun: {id: 's'}}; },
    dispatch: async id => { calls.push(`dispatch:${id}`); if (fail === 'dispatch') throw Error('secret provider details'); return {runId: 'w'}; },
    attach: async (id, wid) => { calls.push(`attach:${id}:${wid}`); if (fail === 'attach') throw Error('database password'); },
    failed: async id => { calls.push(`failed:${id}`); }
  });
  return {handler, calls};
}
test('Given invalid requests, When submitted, Then no work is persisted or dispatched', async () => {
  const {handler, calls} = harness();
  for (const body of [null, [], {}, {url:'garbage'}, {url:'http://example.com'}, {url:'https://u:p@example.com'}, {url:'https://example.com',label:5}, {url:'https://example.com',sourceKind:'WRONG'}]) assert.equal((await handler(request(body))).status, 400);
  assert.equal((await handler(new Request('http://localhost', {method:'POST',body:'{'}))).status,400);
  assert.deepEqual(calls, []);
});
test('Given a valid source, When submitted, Then dispatch and tracking precede 202', async () => {
  const {handler,calls}=harness(); const response=await handler(request({url:'https://example.com/jobs',sourceKind:'HIRING_POSTING'}));
  assert.equal(response.status,202); assert.deepEqual(calls,['create','dispatch:s','attach:s:w']);
  assert.deepEqual(await response.json(),{runId:'r',sourceRunId:'s',workflowRunId:'w',state:'QUEUED'});
});
test('Given dispatch failure, Then the source is marked failed and receives 503',async()=>{
  const {handler,calls}=harness('dispatch'); const response=await handler(request({url:'https://example.com'}));
  assert.equal(response.status,503); assert.deepEqual(calls,['create','dispatch:s','failed:s']); assert.doesNotMatch(await response.text(),/secret/);
});
test('Given tracking failure after dispatch, Then return workflow identity without marking collection failed',async()=>{
  const {handler,calls}=harness('attach'); const response=await handler(request({url:'https://example.com'}));
  assert.equal(response.status,503); assert.equal((await response.json()).workflowRunId,'w'); assert.deepEqual(calls,['create','dispatch:s','attach:s:w']);
});
test('Given unknown company identity, Then return 400 without dispatch',async()=>{
  const {handler,calls}=harness('identity'); assert.equal((await handler(request({url:'https://example.com/blog/a'}))).status,400); assert.deepEqual(calls,['create']);
});
const passage='We deploy retrieval augmented generation in production.';
const signal=()=>({companyId:'a',predicate:'ai_signal',value:{trend:'retrieval',kind:'technical_use'},evidence:[{passage,documentVersion:{body:passage,document:{source:{companyId:'a',type:'technical_article'}}}}]});
test('Given AI evidence, Then acceptance checks exact passage, company identity and kind',()=>{
  validateAiAcceptance(signal());
  const invented=signal(); invented.evidence[0].passage='This passage does not exist.';
  const wrongCompany=signal(); wrongCompany.evidence[0].documentVersion.document.source.companyId='b';
  const wrongKind=signal(); wrongKind.value.kind='hiring_demand';
  const noEvidence=signal(); noEvidence.evidence=[];
  for(const claim of [invented,wrongCompany,wrongKind,noEvidence]) assert.throws(()=>validateAiAcceptance(claim),ReviewError);
});
test('Search snippet metadata cannot replace a directly fetched technical passage',()=>{
  const technicalPassage='We deploy retrieval augmented generation in production.';
  const fetchedBody='This page only announces a company picnic.';
  for(const snippet of ['',technicalPassage,'An elaborate description of production AI systems.']) {
    const claim=signal() as ReturnType<typeof signal> & {discoverySnippet:string};
    claim.discoverySnippet=snippet;
    claim.evidence[0].documentVersion.body=fetchedBody;
    assert.throws(()=>validateAiAcceptance(claim),ReviewError);
  }
  const claim=signal();
  claim.evidence[0].documentVersion.body=`Article body: ${technicalPassage}`;
  assert.doesNotThrow(()=>validateAiAcceptance(claim));
});
test('Given review API input, Then validation precedes mutation and expected errors retain status',async()=>{
  let calls=0;
  const handler=claimReviewHandler(async(id,status,note)=>{calls++; if(id==='missing')throw new ReviewError('Claim not found.',404); return {id,status,note};});
  const context={params:Promise.resolve({id:'c'})};
  for(const body of [null,{status:'YES'},{status:'ACCEPTED',reviewNote:5}]) assert.equal((await handler(request(body),context)).status,400);
  assert.equal(calls,0);
  const ok=await handler(request({status:'REJECTED',reviewNote:'  unsupported  '}),context);
  assert.deepEqual(await ok.json(),{id:'c',status:'REJECTED',note:'unsupported'});
  assert.equal((await handler(request({status:'ACCEPTED'}),{params:Promise.resolve({id:'missing'})})).status,404);
});
