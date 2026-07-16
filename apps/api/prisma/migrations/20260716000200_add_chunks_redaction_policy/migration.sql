ALTER TYPE "DocumentStatus" ADD VALUE 'prepared' BEFORE 'active';
ALTER TYPE "DocumentStatus" ADD VALUE 'policy_blocked' BEFORE 'failed';
ALTER TYPE "IngestionStatus" ADD VALUE 'chunking';
ALTER TYPE "IngestionStatus" ADD VALUE 'policy_check';
ALTER TYPE "IngestionStatus" ADD VALUE 'policy_blocked';

CREATE TYPE "CloudPolicyDecision" AS ENUM ('allowed', 'blocked');

ALTER TABLE "DocumentVersion"
ADD COLUMN "chunkCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "redactionPolicyVersion" TEXT,
ADD COLUMN "cloudPolicyDecision" "CloudPolicyDecision";

CREATE TABLE "KnowledgeChunk" (
    "id" CHAR(64) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "originalText" TEXT NOT NULL,
    "redactedText" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "page" INTEGER,
    "sheet" TEXT,
    "sectionPath" JSONB NOT NULL,
    "elementTypes" JSONB NOT NULL,
    "previousChunkId" CHAR(64),
    "nextChunkId" CHAR(64),
    "redactionPolicyVersion" TEXT NOT NULL,
    "redactionSummary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CloudPolicyEvent" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "ingestionJobId" UUID NOT NULL,
    "decision" "CloudPolicyDecision" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "sensitivity" "Sensitivity" NOT NULL,
    "providerId" TEXT,
    "region" TEXT,
    "redactionPolicyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CloudPolicyEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeChunk_documentId_documentVersion_ordinal_key"
ON "KnowledgeChunk"("documentId", "documentVersion", "ordinal");
CREATE INDEX "KnowledgeChunk_tenantId_documentId_documentVersion_idx"
ON "KnowledgeChunk"("tenantId", "documentId", "documentVersion");
CREATE INDEX "CloudPolicyEvent_tenantId_documentId_createdAt_idx"
ON "CloudPolicyEvent"("tenantId", "documentId", "createdAt");
CREATE INDEX "CloudPolicyEvent_tenantId_decision_createdAt_idx"
ON "CloudPolicyEvent"("tenantId", "decision", "createdAt");

ALTER TABLE "KnowledgeChunk"
ADD CONSTRAINT "KnowledgeChunk_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CloudPolicyEvent"
ADD CONSTRAINT "CloudPolicyEvent_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CloudPolicyEvent"
ADD CONSTRAINT "CloudPolicyEvent_ingestionJobId_fkey"
FOREIGN KEY ("ingestionJobId") REFERENCES "IngestionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
