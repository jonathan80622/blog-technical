import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedSignals, summarizeTrends } from '../lib/ai-signals.ts';

test('keeps exact supported AI signals and rejects invented passages or categories', () => {
 const passage='We deploy retrieval augmented generation for customer support.';
 assert.deepEqual(supportedSignals([{trend:'retrieval',passage},{trend:'retrieval',passage:'Invented evidence'},{trend:'anything',passage}],passage),[{trend:'retrieval',passage}]);
});
test('trend counts distinct companies, separates intent and use, excludes unreviewed evidence', () => {
 const evidence=[{passage:'We deploy retrieval.',documentVersion:{id:'v1',createdAt:new Date('2026-01-01'),document:{canonicalUrl:'https://a.example/blog',publishedAt:null}}}];
 const claim=(id:string,companyId:string,kind:string,status='ACCEPTED')=>({id,companyId,company:{name:companyId},predicate:'ai_signal',value:{trend:'retrieval',kind},status,evidence});
 const result=summarizeTrends([claim('1','a','technical_use'),claim('2','a','technical_use'),claim('3','b','hiring_demand'),claim('4','c','hiring_demand','CANDIDATE'),claim('5','d','technical_use','REJECTED')]);
 assert.equal(result[0].companyCount,2);assert.equal(result[0].technicalCompanies,1);assert.equal(result[0].hiringCompanies,1);
 assert.equal(result[0].evidence.length,3);
});
test('a rejected or evidence-free claim cannot support a trend',()=>{
 assert.deepEqual(summarizeTrends([{id:'x',companyId:'a',company:{name:'A'},predicate:'ai_signal',value:{trend:'retrieval',kind:'technical_use'},status:'ACCEPTED',evidence:[]}]),[]);
});
