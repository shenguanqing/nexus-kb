ALTER TYPE "IngestionStatus" ADD VALUE 'embedding' BEFORE 'policy_blocked';
ALTER TYPE "IngestionStatus" ADD VALUE 'indexing' BEFORE 'policy_blocked';

ALTER TABLE "DocumentVersion"
ADD COLUMN "embeddingFingerprint" CHAR(64),
ADD COLUMN "vectorCollection" TEXT,
ADD COLUMN "indexedAt" TIMESTAMP(3);

ALTER TABLE "IngestionJob"
ADD COLUMN "embeddingFingerprint" CHAR(64),
ADD COLUMN "vectorCollection" TEXT;
