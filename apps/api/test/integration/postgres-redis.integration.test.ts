import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ingestionPayloadSchema } from '@nexus-kb/contracts';
import { AclPolicy } from '../../src/auth/acl-policy';
import type { Identity } from '../../src/auth/identity';
import { AuditService } from '../../src/audit/audit.service';
import type { AppConfig } from '../../src/config/app-config';
import type { PrismaService } from '../../src/database/prisma.service';
import { QueryRateLimiter } from '../../src/knowledge/query-rate-limiter';

describe('PostgreSQL and Redis integration', () => {
  const prisma = new PrismaClient();
  const queueName = `ingestion-test-${randomUUID()}`;
  const queue = new Queue(queueName, { connection: { url: process.env.REDIS_URL } });
  const tenantA = `tenant-a-${randomUUID()}`;
  const tenantB = `tenant-b-${randomUUID()}`;
  const documentId = randomUUID();
  const policyDocumentId = randomUUID();
  const dedupDocumentId = randomUUID();
  const crossTenantDocumentId = randomUUID();
  const replacementDocumentId = randomUUID();
  const aclDocumentId = randomUUID();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.queryAudit.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.document.deleteMany({
      where: {
        id: {
          in: [
            documentId,
            policyDocumentId,
            dedupDocumentId,
            crossTenantDocumentId,
            replacementDocumentId,
            aclDocumentId,
          ],
        },
      },
    });
    await queue.obliterate({ force: true });
    await queue.close();
    await prisma.$disconnect();
  });

  it('enforces tenant criteria before returning a document', async () => {
    await prisma.document.create({
      data: {
        id: documentId,
        tenantId: tenantA,
        sourceName: 'fixture.txt',
        storageKey: `${documentId}.txt`,
        mimeType: 'text/plain',
        contentSha256: '0'.repeat(64),
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'integration-user',
      },
    });

    await expect(
      prisma.document.findFirst({ where: { id: documentId, tenantId: tenantB } }),
    ).resolves.toBeNull();
    await expect(
      prisma.document.findFirst({ where: { id: documentId, tenantId: tenantA } }),
    ).resolves.toMatchObject({ id: documentId });
  });

  it('enforces department, sensitivity, owner and tenant-admin document ACL in PostgreSQL', async () => {
    const policy = new AclPolicy();
    const identity = (overrides: Partial<Identity>): Identity => ({
      tenantId: tenantA,
      userId: 'user-a',
      department: 'legal',
      roles: ['user'],
      allowedSensitivities: ['public', 'internal'],
      capabilities: ['documents:read'],
      defaultSensitivity: 'internal',
      ...overrides,
    });
    await prisma.document.create({
      data: {
        id: aclDocumentId,
        tenantId: tenantA,
        sourceName: 'finance-internal.txt',
        storageKey: `${aclDocumentId}.txt`,
        mimeType: 'text/plain',
        contentSha256: '9'.repeat(64),
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'owner-a',
      },
    });

    await expect(
      prisma.document.findFirst({
        where: { id: aclDocumentId, ...policy.documentWhere(identity({})) },
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.document.findFirst({
        where: {
          id: aclDocumentId,
          ...policy.documentWhere(identity({ department: 'finance' })),
        },
      }),
    ).resolves.toMatchObject({ id: aclDocumentId });
    await expect(
      prisma.document.findFirst({
        where: {
          id: aclDocumentId,
          ...policy.documentWhere(identity({ userId: 'owner-a' })),
        },
      }),
    ).resolves.toMatchObject({ id: aclDocumentId });
    await expect(
      prisma.document.findFirst({
        where: {
          id: aclDocumentId,
          ...policy.documentWhere(identity({ roles: ['admin'] })),
        },
      }),
    ).resolves.toMatchObject({ id: aclDocumentId });
    await expect(
      prisma.document.findFirst({
        where: {
          id: aclDocumentId,
          ...policy.documentWhere(identity({ tenantId: tenantB, roles: ['admin'] })),
        },
      }),
    ).resolves.toBeNull();
  });

  it('stores only validated IDs and a file reference in Redis', async () => {
    const payload = ingestionPayloadSchema.parse({
      ingestionJobId: randomUUID(),
      documentId,
      storageKey: `${documentId}.txt`,
    });
    const job = await queue.add('parse', payload, { jobId: payload.ingestionJobId });
    const stored = await queue.getJob(job.id ?? '');

    expect(stored?.data).toEqual(payload);
    expect(JSON.stringify(stored?.data)).not.toContain('content');
    expect(JSON.stringify(stored?.data)).not.toContain('tenantId');
  });

  it('atomically enforces user and tenant query limits in Redis', async () => {
    const limiter = new QueryRateLimiter({
      values: {
        REDIS_URL: process.env.REDIS_URL,
        QUERY_USER_RATE_LIMIT_PER_MINUTE: 1,
        QUERY_TENANT_RATE_LIMIT_PER_MINUTE: 10,
      },
    } as AppConfig);
    const rateIdentity: Identity = {
      tenantId: `rate-tenant-${randomUUID()}`,
      userId: `rate-user-${randomUUID()}`,
      department: 'finance',
      roles: ['user'],
      allowedSensitivities: ['internal'],
      capabilities: ['documents:read'],
      defaultSensitivity: 'internal',
    };
    try {
      await expect(limiter.assertAllowed(rateIdentity)).resolves.toBeUndefined();
      await expect(limiter.assertAllowed(rateIdentity)).rejects.toMatchObject({
        code: 'QUERY_RATE_LIMITED',
      });
    } finally {
      limiter.onModuleDestroy();
    }
  });

  it('enforces content and ACL deduplication while allowing tenant isolation and re-upload', async () => {
    const contentSha256 = 'd'.repeat(64);
    const tenantADeduplicationKey = 'e'.repeat(64);
    const tenantBDeduplicationKey = 'f'.repeat(64);
    const common = {
      sourceName: 'duplicate.txt',
      mimeType: 'text/plain',
      contentSha256,
      department: 'finance',
      sensitivity: 'internal' as const,
      ownerId: 'integration-user',
    };
    await prisma.document.create({
      data: {
        ...common,
        id: dedupDocumentId,
        tenantId: tenantA,
        deduplicationKey: tenantADeduplicationKey,
        storageKey: `${dedupDocumentId}.txt`,
      },
    });

    await expect(
      prisma.document.create({
        data: {
          ...common,
          id: randomUUID(),
          tenantId: tenantA,
          deduplicationKey: tenantADeduplicationKey,
          storageKey: `${randomUUID()}.txt`,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      prisma.document.create({
        data: {
          ...common,
          id: crossTenantDocumentId,
          tenantId: tenantB,
          deduplicationKey: tenantBDeduplicationKey,
          storageKey: `${crossTenantDocumentId}.txt`,
        },
      }),
    ).resolves.toMatchObject({ id: crossTenantDocumentId });

    await prisma.document.update({
      where: { id: dedupDocumentId },
      data: { status: 'deleted', deletedAt: new Date() },
    });
    await expect(
      prisma.document.create({
        data: {
          ...common,
          id: replacementDocumentId,
          tenantId: tenantA,
          deduplicationKey: tenantADeduplicationKey,
          storageKey: `${replacementDocumentId}.txt`,
        },
      }),
    ).resolves.toMatchObject({ id: replacementDocumentId });
  });

  it('stores tenant-scoped chunks and a bodyless cloud policy event', async () => {
    const ingestionJobId = randomUUID();
    const chunkId = 'a'.repeat(64);
    await prisma.document.create({
      data: {
        id: policyDocumentId,
        tenantId: tenantA,
        sourceName: 'policy-fixture.md',
        storageKey: `${policyDocumentId}.md`,
        mimeType: 'text/markdown',
        contentSha256: '1'.repeat(64),
        department: 'finance',
        sensitivity: 'confidential',
        ownerId: 'integration-user',
        versions: {
          create: {
            id: randomUUID(),
            tenantId: tenantA,
            version: 1,
            chunkCount: 1,
            redactionPolicyVersion: 'v1',
            cloudPolicyDecision: 'blocked',
          },
        },
        jobs: {
          create: {
            id: ingestionJobId,
            tenantId: tenantA,
            version: 1,
            traceId: randomUUID(),
            status: 'policy_blocked',
            step: 'policy_blocked',
          },
        },
        chunks: {
          create: {
            id: chunkId,
            tenantId: tenantA,
            documentVersion: 1,
            ordinal: 0,
            originalText: '测试邮箱 demo@example.com',
            redactedText: '测试邮箱 [REDACTED:EMAIL]',
            tokenCount: 4,
            sectionPath: ['策略'],
            elementTypes: ['paragraph'],
            redactionPolicyVersion: 'v1',
            redactionSummary: { EMAIL: 1 },
          },
        },
      },
    });
    const event = await prisma.cloudPolicyEvent.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA,
        documentId: policyDocumentId,
        documentVersion: 1,
        ingestionJobId,
        decision: 'blocked',
        reasonCode: 'CONFIDENTIAL_CLOUD_EGRESS_DENIED',
        sensitivity: 'confidential',
        redactionPolicyVersion: 'v1',
      },
    });

    await expect(
      prisma.knowledgeChunk.findFirst({
        where: { id: chunkId, tenantId: tenantB },
      }),
    ).resolves.toBeNull();
    expect(Object.keys(event)).not.toContain('text');
    expect(JSON.stringify(event)).not.toContain('demo@example.com');
  });

  it('stores a bodyless query audit with source identifiers', async () => {
    const audit = await prisma.queryAudit.create({
      data: {
        id: randomUUID(),
        traceId: randomUUID(),
        tenantId: tenantA,
        userId: 'integration-user',
        queryLength: 8,
        outcome: 'answered',
        resultCount: 1,
        sourceChunkIds: ['a'.repeat(64)],
        embeddingProvider: 'alibaba',
        embeddingModel: 'text-embedding-v4',
        llmProvider: 'deepseek',
        llmModel: 'deepseek-chat',
        durationMs: 120,
      },
    });

    expect(audit.sourceChunkIds).toEqual(['a'.repeat(64)]);
    expect(Object.keys(audit)).not.toContain('question');
    expect(Object.keys(audit)).not.toContain('answer');
  });

  it('queries audit events with capability and tenant isolation', async () => {
    await prisma.queryAudit.create({
      data: {
        id: randomUUID(),
        traceId: randomUUID(),
        tenantId: tenantB,
        userId: 'cross-tenant-user',
        queryLength: 99,
        outcome: 'failed',
        sourceChunkIds: [],
        durationMs: 1,
      },
    });
    const service = new AuditService(prisma as unknown as PrismaService, new AclPolicy());
    const auditIdentity: Identity = {
      tenantId: tenantA,
      userId: 'auditor-a',
      department: 'audit',
      roles: ['admin'],
      allowedSensitivities: ['public', 'internal', 'confidential'],
      capabilities: ['audit:read'],
      defaultSensitivity: 'internal',
    };

    const result = await service.query({ type: 'query', limit: 100 }, auditIdentity);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.some((event) => event.actorUserId === 'cross-tenant-user')).toBe(false);
    await expect(
      service.query(
        { type: 'query', limit: 10 },
        { ...auditIdentity, capabilities: ['documents:read'] },
      ),
    ).rejects.toMatchObject({ code: 'CAPABILITY_REQUIRED' });
  });
});
