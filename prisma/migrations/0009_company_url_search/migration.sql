CREATE TABLE "CompanyUrlSearch" (
  "id" TEXT NOT NULL,
  "investorId" TEXT NOT NULL,
  "investorName" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'SEARCHING',
  "links" JSONB NOT NULL DEFAULT '[]',
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "response" JSONB,
  "responseId" TEXT,
  "error" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyUrlSearch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyUrlSearch_state_check" CHECK ("state" IN ('SEARCHING', 'SAVED', 'EMPTY', 'FAILED')),
  CONSTRAINT "CompanyUrlSearch_links_check" CHECK (jsonb_typeof("links") = 'array' AND jsonb_array_length("links") = "resultCount"),
  CONSTRAINT "CompanyUrlSearch_saved_check" CHECK (("state" = 'SAVED' AND "resultCount" > 0) OR ("state" <> 'SAVED' AND "resultCount" = 0))
);
CREATE INDEX "CompanyUrlSearch_investorId_createdAt_idx" ON "CompanyUrlSearch"("investorId", "createdAt");
