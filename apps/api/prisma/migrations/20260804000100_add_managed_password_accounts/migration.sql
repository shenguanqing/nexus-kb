ALTER TABLE "UserDirectoryEntry"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "allowedSensitivities" JSONB,
  ADD COLUMN "defaultSensitivity" "Sensitivity",
  ADD COLUMN "authSource" TEXT NOT NULL DEFAULT 'identity',
  ADD COLUMN "passwordSalt" BYTEA,
  ADD COLUMN "passwordDigest" BYTEA,
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "UserDirectoryEntry_username_key" ON "UserDirectoryEntry"("username");

CREATE TABLE "PasswordAuthBootstrap" (
    "id" TEXT NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordAuthBootstrap_pkey" PRIMARY KEY ("id")
);
