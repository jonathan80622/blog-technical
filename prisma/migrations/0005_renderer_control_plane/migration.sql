ALTER TABLE "Job"
  ADD COLUMN "rendererCommandHash" TEXT,
  ADD COLUMN "rendererCommandExpiresAt" TIMESTAMP(3);

CREATE TABLE "RenderArtifact" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "artifactPrefix" TEXT NOT NULL,
  "finalUrl" TEXT,
  "statusCode" INTEGER,
  "telemetry" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RenderArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RenderArtifact_jobId_artifactPrefix_key" ON "RenderArtifact"("jobId", "artifactPrefix");
CREATE INDEX "RenderArtifact_jobId_createdAt_idx" ON "RenderArtifact"("jobId", "createdAt");
ALTER TABLE "RenderArtifact" ADD CONSTRAINT "RenderArtifact_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
