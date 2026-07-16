ALTER TABLE "IngestionJob"
ADD COLUMN "checkpoint" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN "errorCategory" TEXT,
ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Document"
ADD COLUMN "deduplicationKey" CHAR(64);

CREATE INDEX "Document_tenantId_contentSha256_department_sensitivity_ownerId_idx"
ON "Document"("tenantId", "contentSha256", "department", "sensitivity", "ownerId");

CREATE UNIQUE INDEX "Document_active_deduplicationKey_key"
ON "Document"("deduplicationKey")
WHERE "status" <> 'deleted' AND "deduplicationKey" IS NOT NULL;

CREATE UNIQUE INDEX "CloudPolicyEvent_ingestionJobId_key"
ON "CloudPolicyEvent"("ingestionJobId");
