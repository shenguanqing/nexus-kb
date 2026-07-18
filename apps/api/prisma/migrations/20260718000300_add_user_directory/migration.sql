CREATE TABLE "UserDirectoryEntry" (
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "roles" JSONB NOT NULL,
    "lastAuthenticatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserDirectoryEntry_pkey" PRIMARY KEY ("tenantId", "userId")
);

CREATE INDEX "UserDirectoryEntry_tenantId_department_lastAuthenticatedAt_idx"
ON "UserDirectoryEntry"("tenantId", "department", "lastAuthenticatedAt");
