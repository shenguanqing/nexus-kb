ALTER TABLE "IngestionJob"
ADD COLUMN "embeddingCompletedChunks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "embeddingTotalChunks" INTEGER,
ADD COLUMN "embeddingBatchSize" INTEGER;

ALTER TABLE "KnowledgeChunk"
ADD COLUMN "embeddingCacheKey" CHAR(64);

CREATE TABLE "EmbeddingCacheEntry" (
  "key" CHAR(64) NOT NULL,
  "tenantId" TEXT NOT NULL,
  "textSha256" CHAR(64) NOT NULL,
  "embeddingFingerprint" CHAR(64) NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "taskRule" TEXT NOT NULL,
  "chunkMaxTokens" INTEGER NOT NULL,
  "chunkOverlapTokens" INTEGER NOT NULL,
  "redactionPolicyVersion" TEXT NOT NULL,
  "vector" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmbeddingCacheEntry_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "EmbeddingCacheEntry_tenantId_embeddingFingerprint_expiresAt_idx"
ON "EmbeddingCacheEntry"("tenantId", "embeddingFingerprint", "expiresAt");

CREATE INDEX "EmbeddingCacheEntry_tenantId_textSha256_idx"
ON "EmbeddingCacheEntry"("tenantId", "textSha256");
