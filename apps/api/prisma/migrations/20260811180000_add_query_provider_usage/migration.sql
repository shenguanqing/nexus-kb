CREATE TABLE "QueryProviderUsage" (
  "id" UUID NOT NULL,
  "queryTraceId" UUID NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "inputTokens" INTEGER,
  "cacheHitInputTokens" INTEGER,
  "cacheMissInputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "estimatedCostUsd" DECIMAL(20, 12),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QueryProviderUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QueryProviderUsage_tenantId_createdAt_idx"
ON "QueryProviderUsage"("tenantId", "createdAt");

CREATE INDEX "QueryProviderUsage_tenantId_kind_provider_model_createdAt_idx"
ON "QueryProviderUsage"("tenantId", "kind", "provider", "model", "createdAt");

CREATE INDEX "QueryProviderUsage_queryTraceId_idx"
ON "QueryProviderUsage"("queryTraceId");

CREATE UNIQUE INDEX "QueryAudit_traceId_tenantId_key"
ON "QueryAudit"("traceId", "tenantId");

ALTER TABLE "QueryProviderUsage"
ADD CONSTRAINT "QueryProviderUsage_queryTraceId_fkey"
FOREIGN KEY ("queryTraceId", "tenantId") REFERENCES "QueryAudit"("traceId", "tenantId")
ON DELETE CASCADE ON UPDATE CASCADE;
