/** Product taxonomy: counts describe evidence within the selected startup sample. */
export const AI_TRENDS = ['retrieval','agents','model_training','inference','evaluation','multimodal','ai_infrastructure'] as const;
export type AiTrend = typeof AI_TRENDS[number];
export type SignalKind = 'hiring_demand' | 'technical_use';
export type SignalCandidate = { trend: AiTrend; passage: string };
export function supportedSignals(items: unknown[], body: string): SignalCandidate[] {
 const seen=new Set<string>();
 return items.flatMap(item=>{
  if(!item||typeof item!=='object')return [];
  const {trend,passage}=item as Record<string,unknown>;
  if(typeof trend!=='string'||!AI_TRENDS.includes(trend as AiTrend)||typeof passage!=='string'||passage.length<12||passage.length>1200||!body.includes(passage))return [];
  const key=trend+'\n'+passage;if(seen.has(key))return [];seen.add(key);
  return [{trend:trend as AiTrend,passage}];
 });
}
type Evidence={passage:string;documentVersion:{id:string;createdAt:Date|string;document:{canonicalUrl:string;publishedAt:Date|string|null}}};
type SignalClaim={id:string;companyId:string|null;company:{name:string}|null;predicate:string;value:unknown;status:string;evidence:Evidence[]};
export function summarizeTrends(claims:SignalClaim[]) {
 const groups=new Map<AiTrend,{companies:Set<string>;hiring:Set<string>;technical:Set<string>;evidence:Array<{claimId:string;company:string;kind:SignalKind;passage:string;url:string;versionId:string;observedAt:Date|string;publishedAt:Date|string|null}>}>();
 for(const claim of claims){
  if(claim.predicate!=='ai_signal'||claim.status!=='ACCEPTED'||!claim.companyId||!claim.company||!claim.evidence.length||!claim.value||typeof claim.value!=='object')continue;
  const {trend,kind}=claim.value as {trend:AiTrend;kind:SignalKind};
  if(!AI_TRENDS.includes(trend)||!['hiring_demand','technical_use'].includes(kind))continue;
  const group=groups.get(trend)??{companies:new Set<string>(),hiring:new Set<string>(),technical:new Set<string>(),evidence:[]};
  group.companies.add(claim.companyId);(kind==='hiring_demand'?group.hiring:group.technical).add(claim.companyId);
  for(const e of claim.evidence)group.evidence.push({claimId:claim.id,company:claim.company.name,kind,passage:e.passage,url:e.documentVersion.document.canonicalUrl,versionId:e.documentVersion.id,observedAt:e.documentVersion.createdAt,publishedAt:e.documentVersion.document.publishedAt});
  groups.set(trend,group);
 }
 return [...groups].map(([trend,g])=>({trend,companyCount:g.companies.size,hiringCompanies:g.hiring.size,technicalCompanies:g.technical.size,evidence:g.evidence})).sort((a,b)=>b.companyCount-a.companyCount||a.trend.localeCompare(b.trend));
}
