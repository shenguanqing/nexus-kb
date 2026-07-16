CREATE TYPE "Sensitivity" AS ENUM ('public', 'internal', 'confidential');
CREATE TYPE "DocumentStatus" AS ENUM ('uploaded', 'processing', 'active', 'failed', 'deleted');
CREATE TYPE "IngestionStatus" AS ENUM ('queued', 'parsing', 'completed', 'failed', 'deleted');

CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "sensitivity" "Sensitivity" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "activeVersion" INTEGER,
    "status" "DocumentStatus" NOT NULL DEFAULT 'uploaded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentVersion" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "parser" TEXT,
    "parserVersion" TEXT,
    "parsedElements" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IngestionJob" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'queued',
    "step" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "traceId" UUID NOT NULL,
    "parserVersion" TEXT,
    "warnings" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");
CREATE INDEX "Document_tenantId_status_idx" ON "Document"("tenantId", "status");
CREATE INDEX "Document_tenantId_createdAt_idx" ON "Document"("tenantId", "createdAt");
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");
CREATE INDEX "DocumentVersion_tenantId_documentId_idx" ON "DocumentVersion"("tenantId", "documentId");
CREATE INDEX "IngestionJob_tenantId_status_idx" ON "IngestionJob"("tenantId", "status");
CREATE INDEX "IngestionJob_tenantId_documentId_idx" ON "IngestionJob"("tenantId", "documentId");

ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
