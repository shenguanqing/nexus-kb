import { describe, expect, it, vi } from 'vitest';
import { UsageService } from '../src/usage/usage.service';
import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'admin-a',
  department: 'platform',
  roles: ['admin'],
  allowedSensitivities: ['public', 'internal', 'confidential'],
  capabilities: ['system:read'],
  defaultSensitivity: 'internal',
};

const googleEmbeddingConfig = {
  values: {
    EMBEDDING_PROVIDER: 'google',
    EMBEDDING_MODEL: 'gemini-embedding-001',
  },
} as unknown as AppConfig;

describe('UsageService', () => {
  it('aggregates tenant-scoped request facts without inventing tokens or cost', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        outcome: 'answered',
        durationMs: 100,
        department: 'finance',
        embeddingProvider: 'alibaba',
        embeddingModel: 'embed-a',
        rerankProvider: null,
        rerankModel: null,
        llmProvider: 'deepseek',
        llmModel: 'chat-a',
      },
      {
        outcome: 'failed',
        durationMs: 900,
        department: 'finance',
        embeddingProvider: 'alibaba',
        embeddingModel: 'embed-a',
        rerankProvider: null,
        rerankModel: null,
        llmProvider: null,
        llmModel: null,
      },
    ]);
    const service = new UsageService(
      { queryAudit: { findMany } } as unknown as PrismaService,
      new AclPolicy(),
      googleEmbeddingConfig,
    );
    const result = await service.query(
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' },
      identity,
    );
    const [input] = findMany.mock.calls[0] as [{ where: { tenantId: string } }];
    expect(input.where.tenantId).toBe('tenant-a');
    expect(result).toMatchObject({
      totalQueries: 2,
      failureRate: 0.5,
      queryP95Ms: 900,
      usageCompleteness: 'request_only',
    });
    expect(result.providers.find((row) => row.kind === 'embedding')).toMatchObject({
      requests: 2,
      failures: 1,
      inputTokens: null,
      estimatedCostUsd: null,
    });
    expect(result.providers).toContainEqual({
      kind: 'embedding',
      provider: 'google',
      model: 'gemini-embedding-001',
      requests: 0,
      failures: 0,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
    });
  });

  it('shows the current embedding provider and model before the first query audit exists', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new UsageService(
      { queryAudit: { findMany } } as unknown as PrismaService,
      new AclPolicy(),
      googleEmbeddingConfig,
    );

    const result = await service.query(
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' },
      identity,
    );

    expect(result.providers).toEqual([
      {
        kind: 'embedding',
        provider: 'google',
        model: 'gemini-embedding-001',
        requests: 0,
        failures: 0,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
      },
    ]);
  });

  it('requires platform administrator role before database access', async () => {
    const findMany = vi.fn();
    const service = new UsageService(
      { queryAudit: { findMany } } as unknown as PrismaService,
      new AclPolicy(),
      googleEmbeddingConfig,
    );
    await expect(
      service.query(
        { from: '2026-07-01T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' },
        { ...identity, roles: ['user'] },
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
