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

function prismaWithUsage(queryAudits: unknown[], usageFacts: unknown[] = []): PrismaService {
  return {
    queryAudit: { findMany: vi.fn().mockResolvedValue(queryAudits) },
    queryProviderUsage: { findMany: vi.fn().mockResolvedValue(usageFacts) },
  } as unknown as PrismaService;
}

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
    const prisma = prismaWithUsage([]);
    (prisma.queryAudit.findMany as ReturnType<typeof vi.fn>) = findMany;
    const service = new UsageService(prisma, new AclPolicy(), googleEmbeddingConfig);
    const result = await service.query(
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' },
      identity,
    );
    const [input] = findMany.mock.calls[0] as [{ where: { tenantId: string } }];
    expect(input.where.tenantId).toBe('tenant-a');
    expect(result).toMatchObject({
      totalQueries: 2,
      failureRate: 0.5,
      queryP50Ms: 100,
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
    const service = new UsageService(prismaWithUsage([]), new AclPolicy(), googleEmbeddingConfig);

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

  it('aggregates persisted token and configured cost facts without cross-tenant data', async () => {
    const prisma = prismaWithUsage(
      [
        {
          outcome: 'answered',
          durationMs: 120,
          department: 'finance',
          embeddingProvider: null,
          embeddingModel: null,
          rerankProvider: null,
          rerankModel: null,
          llmProvider: 'deepseek',
          llmModel: 'chat-a',
        },
      ],
      [
        {
          queryTraceId: '11111111-1111-4111-8111-111111111111',
          kind: 'llm',
          provider: 'deepseek',
          model: 'chat-a',
          status: 'success',
          inputTokens: 120,
          outputTokens: 30,
          estimatedCostUsd: 0.00018,
        },
      ],
    );
    const service = new UsageService(prisma, new AclPolicy(), googleEmbeddingConfig);

    const result = await service.query(
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' },
      identity,
    );

    expect(result.providers).toContainEqual({
      kind: 'llm',
      provider: 'deepseek',
      model: 'chat-a',
      requests: 1,
      failures: 0,
      inputTokens: 120,
      outputTokens: 30,
      estimatedCostUsd: 0.00018,
    });
    expect(result.usageCompleteness).toBe('tokens_and_cost');
    const usageInput = (prisma.queryProviderUsage.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { where: { tenantId: string } };
    expect(usageInput.where.tenantId).toBe('tenant-a');
  });

  it('keeps cost unknown when a successful provider call has no configured estimate', async () => {
    const service = new UsageService(
      prismaWithUsage(
        [
          {
            outcome: 'answered',
            durationMs: 120,
            department: 'finance',
            embeddingProvider: null,
            embeddingModel: null,
            rerankProvider: null,
            rerankModel: null,
            llmProvider: 'deepseek',
            llmModel: 'chat-a',
          },
        ],
        [
          {
            queryTraceId: '11111111-1111-4111-8111-111111111111',
            kind: 'llm',
            provider: 'deepseek',
            model: 'chat-a',
            status: 'success',
            inputTokens: 120,
            outputTokens: 30,
            estimatedCostUsd: null,
          },
        ],
      ),
      new AclPolicy(),
      googleEmbeddingConfig,
    );

    const result = await service.query(
      { from: '2026-07-01T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' },
      identity,
    );

    expect(result.providers.find((provider) => provider.kind === 'llm')).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      estimatedCostUsd: null,
    });
    expect(result.usageCompleteness).toBe('request_only');
  });

  it('requires platform administrator role before database access', async () => {
    const findMany = vi.fn();
    const service = new UsageService(prismaWithUsage([]), new AclPolicy(), googleEmbeddingConfig);
    await expect(
      service.query(
        { from: '2026-07-01T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' },
        { ...identity, roles: ['user'] },
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
