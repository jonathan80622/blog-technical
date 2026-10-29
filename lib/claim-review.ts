import { supportedSignals } from './ai-signals.ts';
import { emitTestTrace } from './test-trace.ts';
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
    const effects: unknown[] = [];
    const respond = (body: unknown, status = 200) => { emitTestTrace({handler: 'claimReviewHandler', input, effects, response: {status, body}}); return Response.json(body, {status}); };
    try { input = await request.json(); } catch { return respond({error: 'Invalid JSON body.'}, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return respond({error: 'Expected an object.'}, 400);
    const {status, reviewNote} = input as Record<string, unknown>;
    if (!['CANDIDATE', 'ACCEPTED', 'REJECTED', 'CONFLICTING'].includes(status as string)) return respond({error: 'Invalid claim status.'}, 400);
    if (reviewNote !== undefined && (typeof reviewNote !== 'string' || reviewNote.length > 5000)) return respond({error: 'reviewNote must be text of at most 5000 characters.'}, 400);
    try {
      const id = (await context.params).id;
      const reviewInput = {id, status: status as ReviewStatus, reviewNote: (reviewNote as string | undefined)?.trim() || null};
      const output = await review(reviewInput.id, reviewInput.status, reviewInput.reviewNote);
      effects.push({operation: 'review', input: reviewInput, output});
      return respond(output);
    } catch (error) {
      effects.push({operation: 'review', threw: error instanceof Error ? error.message : String(error)});
      return respond({error: error instanceof ReviewError ? error.message : 'Claim review service unavailable.'}, error instanceof ReviewError ? error.status : 503);
    }
  };
}
