ALTER TABLE "Document"
ADD COLUMN "previewStorageKey" TEXT,
ADD COLUMN "previewKind" TEXT,
ADD COLUMN "previewMimeType" TEXT,
ADD COLUMN "previewSizeBytes" INTEGER,
ADD COLUMN "previewRenderer" TEXT,
ADD COLUMN "previewRendererVersion" TEXT,
ADD COLUMN "previewGeneratedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "Document_previewStorageKey_key"
ON "Document"("previewStorageKey");
