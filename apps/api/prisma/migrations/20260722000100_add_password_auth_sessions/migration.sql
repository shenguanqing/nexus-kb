CREATE TABLE "PasswordAuthSession" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordAuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordAuthSession_tokenHash_key" ON "PasswordAuthSession"("tokenHash");
CREATE INDEX "PasswordAuthSession_expiresAt_idx" ON "PasswordAuthSession"("expiresAt");
CREATE INDEX "PasswordAuthSession_tenantId_userId_expiresAt_idx" ON "PasswordAuthSession"("tenantId", "userId", "expiresAt");
