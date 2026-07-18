CREATE TABLE "QueryAudit" (
    "id" UUID NOT NULL,
    "traceId" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "queryLength" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "sourceChunkIds" JSONB NOT NULL,
    "embeddingProvider" TEXT,
    "embeddingModel" TEXT,
    "rerankProvider" TEXT,
    "rerankModel" TEXT,
    "rerankDegraded" BOOLEAN NOT NULL DEFAULT false,
    "llmProvider" TEXT,
    "llmModel" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QueryAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QueryAudit_traceId_key" ON "QueryAudit"("traceId");
CREATE INDEX "QueryAudit_tenantId_createdAt_idx" ON "QueryAudit"("tenantId", "createdAt");
CREATE INDEX "QueryAudit_tenantId_userId_createdAt_idx" ON "QueryAudit"("tenantId", "userId", "createdAt");
