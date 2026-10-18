ALTER TABLE "DocumentVersion"
  ADD COLUMN "rawHtml" TEXT,
  ADD COLUMN "links" JSONB;
