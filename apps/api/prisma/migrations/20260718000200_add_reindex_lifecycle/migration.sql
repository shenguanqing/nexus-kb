CREATE TYPE "DocumentVersionStatus" AS ENUM (
  'processing',
  'prepared',
  'policy_blocked',
  'active',
  'superseded',
  'failed',
  'deleted'
);

ALTER TABLE "DocumentVersion"
ADD COLUMN "status" "DocumentVersionStatus" NOT NULL DEFAULT 'processing',
ADD COLUMN "activatedAt" TIMESTAMP(3),
ADD COLUMN "supersededAt" TIMESTAMP(3);

UPDATE "DocumentVersion" AS version
SET "status" = (CASE
  WHEN document."activeVersion" = version."version" THEN 'active'
  WHEN version."indexedAt" IS NOT NULL THEN 'superseded'
  ELSE 'failed'
END)::"DocumentVersionStatus",
"activatedAt" = CASE
  WHEN document."activeVersion" = version."version" THEN COALESCE(version."indexedAt", version."createdAt")
  ELSE NULL
END
FROM "Document" AS document
WHERE document."id" = version."documentId";

ALTER TABLE "IngestionJob"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ingestion',
ADD COLUMN "activateOnComplete" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "DocumentLifecycleAudit" (
  "id" UUID NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "traceId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "documentVersion" INTEGER,
  "ingestionJobId" UUID,
  "eventType" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "vectorCollection" TEXT,
  "embeddingFingerprint" CHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentLifecycleAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentLifecycleAudit_tenantId_documentId_createdAt_idx"
ON "DocumentLifecycleAudit"("tenantId", "documentId", "createdAt");

CREATE INDEX "DocumentLifecycleAudit_tenantId_eventType_createdAt_idx"
ON "DocumentLifecycleAudit"("tenantId", "eventType", "createdAt");

CREATE INDEX "DocumentLifecycleAudit_traceId_idx"
ON "DocumentLifecycleAudit"("traceId");
