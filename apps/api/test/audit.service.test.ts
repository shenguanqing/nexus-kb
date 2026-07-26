import { describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/database/prisma.service';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'auditor-a',
  department: 'audit',
  roles: ['platform_admin'],
  allowedSensitivities: ['public', 'internal', 'confidential'],
  capabilities: ['audit:read'],
  defaultSensitivity: 'internal',
};

function fixture() {
  const queryFindMany = vi.fn().mockResolvedValue([
    {
      id: '11111111-1111-4111-8111-111111111111',
      traceId: '21111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-a',
      userId: 'user-a',
      queryLength: 12,
      outcome: 'answered',
      answerMode: 'general',
      resultCount: 1,
      sourceChunkIds: ['a'.repeat(64)],
      embeddingProvider: 'alibaba',
      embeddingModel: 'text-embedding-v4',
      rerankProvider: null,
      rerankModel: null,
      rerankDegraded: false,
      llmProvider: 'deepseek',
      llmModel: 'model-a',
      fallbackUsed: false,
      errorCode: null,
      durationMs: 120,
      createdAt: new Date('2026-07-18T00:00:03.000Z'),
    },
  ]);
  const lifecycleFindMany = vi.fn().mockResolvedValue([
    {
      id: '31111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-a',
      userId: 'admin-a',
      traceId: '41111111-1111-4111-8111-111111111111',
      documentId: '51111111-1111-4111-8111-111111111111',
      documentVersion: 2,
      ingestionJobId: '61111111-1111-4111-8111-111111111111',
      eventType: 'document_version_activated',
      outcome: 'completed',
      vectorCollection: 'nexuskb_collection',
      embeddingFingerprint: 'b'.repeat(64),
      createdAt: new Date('2026-07-18T00:00:02.000Z'),
    },
  ]);
  const policyFindMany = vi.fn().mockResolvedValue([
    {
      id: '71111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-a',
      documentId: '81111111-1111-4111-8111-111111111111',
      documentVersion: 1,
      ingestionJobId: '91111111-1111-4111-8111-111111111111',
      decision: 'blocked',
      reasonCode: 'CONFIDENTIAL_CLOUD_EGRESS_DENIED',
      sensitivity: 'confidential',
      providerId: null,
      region: null,
      redactionPolicyVersion: 'v1',
      createdAt: new Date('2026-07-18T00:00:01.000Z'),
      ingestionJob: { traceId: 'a1111111-1111-4111-8111-111111111111' },
    },
  ]);
  const accessFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    queryAudit: { findMany: queryFindMany },
    documentLifecycleAudit: { findMany: lifecycleFindMany },
    cloudPolicyEvent: { findMany: policyFindMany },
    accessAudit: { findMany: accessFindMany },
  } as unknown as PrismaService;
  return {
    service: new AuditService(prisma, new AclPolicy()),
    queryFindMany,
    lifecycleFindMany,
    policyFindMany,
    accessFindMany,
  };
}

describe('AuditService', () => {
  it('returns merged tenant-scoped structured events without body content', async () => {
    const deps = fixture();
    const result = await deps.service.query({ limit: 50 }, identity);

    expect(result.events.map((event) => event.type)).toEqual([
      'query',
      'document_lifecycle',
      'cloud_policy',
    ]);
    expect(result.events.at(-1)?.traceId).toBe('a1111111-1111-4111-8111-111111111111');
    expect(deps.queryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
    expect(deps.lifecycleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('"question":');
    expect(serialized).not.toContain('"answer":');
    expect(serialized).not.toContain('"originalText":');
    expect(serialized).not.toContain('"redactedText":');
  });

  it('only queries the selected event type', async () => {
    const deps = fixture();
    await deps.service.query({ type: 'query', limit: 10 }, identity);

    expect(deps.queryFindMany).toHaveBeenCalledOnce();
    expect(deps.lifecycleFindMany).not.toHaveBeenCalled();
    expect(deps.policyFindMany).not.toHaveBeenCalled();
  });

  it('rejects identities without audit capability before database access', async () => {
    const deps = fixture();
    await expect(
      deps.service.query({ limit: 10 }, { ...identity, capabilities: ['documents:read'] }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_REQUIRED' });
    expect(deps.queryFindMany).not.toHaveBeenCalled();
  });
});
