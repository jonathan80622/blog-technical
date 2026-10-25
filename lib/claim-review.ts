import { supportedSignals } from './ai-signals.ts';
export type ReviewStatus = 'CANDIDATE' | 'ACCEPTED' | 'REJECTED' | 'CONFLICTING';
export class ReviewError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export function validateAiAcceptance(claim: {
  companyId: string | null; predicate: string; value: unknown;
  evidence: Array<{passage: string; documentVersion: {body: string; document: {source: {companyId: string | null; type: string}}}}>;
}) {
  if (claim.predicate !== 'ai_signal') return;
  const value = claim.value as {trend?: unknown; kind?: unknown} | null;
  const sourceType = value?.kind === 'hiring_demand' ? 'hiring_posting' : value?.kind === 'technical_use' ? 'technical_article' : null;
  if (!claim.companyId || !sourceType || !claim.evidence.length || !claim.evidence.every(e =>
    e.documentVersion.document.source.companyId === claim.companyId &&
    e.documentVersion.document.source.type === sourceType &&
    supportedSignals([{trend: value?.trend, passage: e.passage}], e.documentVersion.body).length === 1
  )) throw new ReviewError('AI signals require exact evidence from a matching company source and signal kind.', 422);
}
export function claimReviewHandler(review: (id: string, status: ReviewStatus, note: string | null) => Promise<unknown>) {
  return async (request: Request, context: {params: Promise<{id: string}>}): Promise<Response> => {
    let input: unknown;
    try { input = await request.json(); } catch { return Response.json({error: 'Invalid JSON body.'}, {status: 400}); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return Response.json({error: 'Expected an object.'}, {status: 400});
    const {status, reviewNote} = input as Record<string, unknown>;
    if (!['CANDIDATE', 'ACCEPTED', 'REJECTED', 'CONFLICTING'].includes(status as string)) return Response.json({error: 'Invalid claim status.'}, {status: 400});
    if (reviewNote !== undefined && (typeof reviewNote !== 'string' || reviewNote.length > 5000)) return Response.json({error: 'reviewNote must be text of at most 5000 characters.'}, {status: 400});
    try {
      return Response.json(await review((await context.params).id, status as ReviewStatus, (reviewNote as string | undefined)?.trim() || null));
    } catch (error) {
      return Response.json({error: error instanceof ReviewError ? error.message : 'Claim review service unavailable.'}, {status: error instanceof ReviewError ? error.status : 503});
    }
  };
}
