ALTER TABLE "Document" ADD COLUMN "finalUrl" TEXT;
ALTER TABLE "JobAttempt" ADD COLUMN "requestedUrl" TEXT;
ALTER TABLE "JobAttempt" ADD COLUMN "finalUrl" TEXT;
ALTER TABLE "JobAttempt" ADD COLUMN "httpStatus" INTEGER;
ALTER TABLE "JobAttempt" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobAttempt" ADD COLUMN "fetchOutcome" TEXT;
ALTER TABLE "JobAttempt" ADD COLUMN "fetchAttempts" JSONB;
