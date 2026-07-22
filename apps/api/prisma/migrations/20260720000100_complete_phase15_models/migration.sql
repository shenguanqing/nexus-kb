ALTER TABLE "QueryAudit" ADD COLUMN "department" TEXT;
ALTER TABLE "UserDirectoryEntry" ADD COLUMN "managedRoles" JSONB;

CREATE TABLE "DepartmentPolicy" (
    "tenantId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "allowedSensitivities" JSONB NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DepartmentPolicy_pkey" PRIMARY KEY ("tenantId", "department")
);
CREATE INDEX "DepartmentPolicy_tenantId_updatedAt_idx" ON "DepartmentPolicy"("tenantId", "updatedAt");

CREATE TABLE "AccessAudit" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "traceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccessAudit_tenantId_createdAt_idx" ON "AccessAudit"("tenantId", "createdAt");
CREATE INDEX "AccessAudit_tenantId_targetType_targetId_createdAt_idx" ON "AccessAudit"("tenantId", "targetType", "targetId", "createdAt");

CREATE TABLE "KnowledgeConversation" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "KnowledgeConversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KnowledgeConversation_tenantId_userId_updatedAt_idx" ON "KnowledgeConversation"("tenantId", "userId", "updatedAt");

CREATE TABLE "KnowledgeTurn" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "noAnswer" BOOLEAN NOT NULL,
    "reason" TEXT,
    "traceId" UUID NOT NULL,
    "sources" JSONB NOT NULL,
    "model" JSONB,
    "rerankDegraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeTurn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeTurn_traceId_key" UNIQUE ("traceId"),
    CONSTRAINT "KnowledgeTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "KnowledgeConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "KnowledgeTurn_conversationId_createdAt_idx" ON "KnowledgeTurn"("conversationId", "createdAt");
