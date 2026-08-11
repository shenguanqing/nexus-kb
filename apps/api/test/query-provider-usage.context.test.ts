import { describe, expect, it } from 'vitest';

import type { Identity } from '../src/auth/identity';
import type { AppConfig } from '../src/config/app-config';
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

const config = {
  values: {
    MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON: {
      'deepseek:chat-a': { input: 1, output: 2 },
      'deepseek:chat-cache': {
        input: 1,
        output: 2,
        cacheHitInput: 0.1,
        cacheMissInput: 1,
      },
    },
  },
} as unknown as AppConfig;

describe('QueryProviderUsageContext', () => {
  it('attributes reported tokens and configured cost to the active tenant query', async () => {
    const context = new QueryProviderUsageContext(config);
    const traceId = '11111111-1111-4111-8111-111111111111';

    await context.run(identity, traceId, () => {
      context.record('llm', {
        provider: 'deepseek',
        model: 'chat-a',
        status: 'success',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      expect(context.facts(traceId)).toEqual([
        expect.objectContaining({
          queryTraceId: traceId,
          tenantId: 'tenant-a',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          estimatedCostUsd: 0.00002,
        }),
      ]);
      return Promise.resolve();
    });
  });

  it('uses cache-specific prices only when provider cache usage is complete', async () => {
    const context = new QueryProviderUsageContext(config);
    const traceId = '22222222-2222-4222-8222-222222222222';

    await context.run(identity, traceId, () => {
      context.record('llm', {
        provider: 'deepseek',
        model: 'chat-cache',
        status: 'success',
        inputTokens: 100,
        cacheHitInputTokens: 80,
        cacheMissInputTokens: 20,
        outputTokens: 10,
      });
      expect(context.facts(traceId)[0]?.estimatedCostUsd).toBe(0.000048);
      return Promise.resolve();
    });
  });

  it('keeps cost unknown when pricing or token usage is missing', async () => {
    const context = new QueryProviderUsageContext(config);
    const traceId = '33333333-3333-4333-8333-333333333333';

    await context.run(identity, traceId, () => {
      context.record('embedding', {
        provider: 'ollama',
        model: 'bge-m3:latest',
        status: 'success',
      });
      expect(context.facts(traceId)[0]).toMatchObject({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
      });
      return Promise.resolve();
    });
  });
});
