CREATE EXTENSION IF NOT EXISTS vector;
CREATE TYPE "JobState" AS ENUM ('PENDING','QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD_LETTER');
CREATE TABLE "Source" (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, type TEXT NOT NULL, capabilities TEXT[] NOT NULL, rationale TEXT, "lastSuccessAt" TIMESTAMP(3), "investorId" TEXT, "companyId" TEXT);
CREATE TABLE "Document" (id TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL REFERENCES "Source"(id), "canonicalUrl" TEXT NOT NULL UNIQUE, title TEXT, "publishedAt" TIMESTAMP(3), "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "contentHash" TEXT NOT NULL, "snapshotKey" TEXT);
CREATE TABLE "DocumentVersion" (id TEXT PRIMARY KEY, "documentId" TEXT NOT NULL REFERENCES "Document"(id), body TEXT NOT NULL, "parserVersion" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "DocumentChunk" (id TEXT PRIMARY KEY, "documentVersionId" TEXT NOT NULL REFERENCES "DocumentVersion"(id), ordinal INTEGER NOT NULL, text TEXT NOT NULL, "embeddingModel" TEXT NOT NULL, "embeddingVersion" TEXT NOT NULL, UNIQUE("documentVersionId",ordinal));
CREATE TABLE "Job" (id TEXT PRIMARY KEY, type TEXT NOT NULL, "entityId" TEXT, "deduplicationKey" TEXT NOT NULL UNIQUE, state "JobState" NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, progress TEXT, "leaseUntil" TIMESTAMP(3), cost DECIMAL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "JobAttempt" (id TEXT PRIMARY KEY, "jobId" TEXT NOT NULL REFERENCES "Job"(id), state "JobState" NOT NULL, error TEXT, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3));
-- Vector DDL stays explicit while this project uses Prisma 6.
ALTER TABLE "DocumentChunk" ADD COLUMN embedding vector(1536);
CREATE INDEX IF NOT EXISTS document_chunk_embedding_idx ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);
