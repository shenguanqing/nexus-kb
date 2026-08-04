CREATE TABLE "SystemConfigVersion" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "encryptedConfig" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "changedKeys" JSONB NOT NULL,
    "changeReason" VARCHAR(500) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMPTZ(3),
    CONSTRAINT "SystemConfigVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SystemDeployment" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "configVersionId" UUID NOT NULL,
    "previousConfigVersionId" UUID,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "services" JSONB NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "traceId" UUID NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "SystemDeployment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemConfigVersion_tenantId_version_key"
ON "SystemConfigVersion"("tenantId", "version");
CREATE INDEX "SystemConfigVersion_tenantId_status_createdAt_idx"
ON "SystemConfigVersion"("tenantId", "status", "createdAt");
CREATE INDEX "SystemDeployment_tenantId_createdAt_idx"
ON "SystemDeployment"("tenantId", "createdAt");
CREATE INDEX "SystemDeployment_tenantId_status_idx"
ON "SystemDeployment"("tenantId", "status");

ALTER TABLE "SystemDeployment"
ADD CONSTRAINT "SystemDeployment_configVersionId_fkey"
FOREIGN KEY ("configVersionId") REFERENCES "SystemConfigVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SystemDeployment"
ADD CONSTRAINT "SystemDeployment_previousConfigVersionId_fkey"
FOREIGN KEY ("previousConfigVersionId") REFERENCES "SystemConfigVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
