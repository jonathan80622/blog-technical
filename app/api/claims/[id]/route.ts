import { db } from "@/lib/db";
import { claimReviewHandler, ReviewError, validateAiAcceptance } from "@/lib/claim-review";

export const PATCH = claimReviewHandler((id, status, reviewNote) => db.$transaction(async tx => {
  const existing = await tx.claim.findUnique({where: {id}, include: {evidence: {include: {documentVersion: {include: {document: {include: {source: true}}}}}}}});
  if (!existing) throw new ReviewError('Claim not found.', 404);
  if (status === 'ACCEPTED') validateAiAcceptance(existing);
  const claim = await tx.claim.update({where: {id}, data: {status, reviewNote}});
  if (existing.companyId && existing.predicate.startsWith('portfolio_membership:')) {
    const value = existing.value as {investorId?: unknown; sourceId?: unknown};
    if (value && typeof value.investorId === 'string' && typeof value.sourceId === 'string') {
      const membership = {investorId: value.investorId, companyId: existing.companyId, sourceId: value.sourceId};
      if (status === 'ACCEPTED') await tx.portfolioRelationship.upsert({where: {investorId_companyId_sourceId: membership}, update: {}, create: membership});
      else await tx.portfolioRelationship.deleteMany({where: membership});
    }
  }
  return claim;
}));
