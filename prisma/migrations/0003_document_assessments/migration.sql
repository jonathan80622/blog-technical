CREATE TABLE "DocumentAssessment" (
  "id" TEXT PRIMARY KEY,
  "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE CASCADE,
  "model" TEXT NOT NULL,
  "adapterVerdict" TEXT NOT NULL,
  "renderingVerdict" TEXT NOT NULL,
  "completenessVerdict" TEXT NOT NULL,
  "confidence" DECIMAL,
  "inputHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DocumentAssessment_documentId_createdAt_idx" ON "DocumentAssessment"("documentId","createdAt");
