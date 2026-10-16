CREATE EXTENSION IF NOT EXISTS vector;
-- Prisma owns relational tables. Keep vector DDL explicit while the app remains on Prisma 6.
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS document_chunk_embedding_idx ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);
