import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';
import { QueryAuditService } from '../src/knowledge/query-audit.service';
import { QueryProviderUsageContext } from '../src/usage/query-provider-usage.context';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: ['user'],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read'],
  defaultSensitivity: 'internal',
};

describe('QueryAuditService provider usage', () => {
  it('atomically nests tenant-attributed provider facts without business text', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const context = new QueryProviderUsageContext({
      values: {
        MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON: {
          'deepseek:chat-a': { input: 1, output: 2 },
        },
      },
    } as unknown as AppConfig);
    const service = new QueryAuditService(
      { queryAudit: { create } } as unknown as PrismaService,
      context,
    );
    const traceId = '11111111-1111-4111-8111-111111111111';

    await context.run(identity, traceId, async () => {
      context.record('llm', {
        provider: 'deepseek',
        model: 'chat-a',
        status: 'success',
        inputTokens: 10,
        outputTokens: 5,
      });
      await service.record({
        traceId,
        identity,
        queryLength: 8,
        outcome: 'answered',
        resultCount: 1,
        sourceChunkIds: ['a'.repeat(64)],
        llmProvider: 'deepseek',
        llmModel: 'chat-a',
        durationMs: 120,
      });
    });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        tenantId: 'tenant-a',
        traceId,
        providerUsages: {
          create: [
            {
              kind: 'llm',
              provider: 'deepseek',
              model: 'chat-a',
              inputTokens: 10,
              outputTokens: 5,
              estimatedCostUsd: 0.00002,
            },
          ],
        },
      },
    });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(
      /"providerUsages":\{"create":\[\{[^}]*"tenantId"/,
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain('问题正文');
  });
});
