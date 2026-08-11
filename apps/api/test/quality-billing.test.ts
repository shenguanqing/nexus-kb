import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { billableProviders, billingDelta } from '../src/evaluation/quality-billing';

function config(pricing: Record<string, { input: number; output: number }>): AppConfig {
  return {
    values: {
      LLM_PROVIDER: 'google',
      LLM_MODEL: 'gemini-model',
      LLM_FALLBACK_PROVIDER: 'none',
      LLM_FALLBACK_MODEL: '',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
      RERANK_PROVIDER: 'local_bge',
      RERANK_MODEL: 'bge-reranker',
      MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON: pricing,
    },
  } as unknown as AppConfig;
}

describe('quality evaluation billing', () => {
  it('requires pricing for configured cloud providers but not local inference', () => {
    expect([
      ...billableProviders(config({ 'google:gemini-model': { input: 1, output: 2 } })),
    ]).toEqual(['google:gemini-model']);
    expect(() => billableProviders(config({}))).toThrow('explicit pricing');
  });

  it('attributes the isolated provider counter delta to one observation', () => {
    expect(
      billingDelta(
        { estimatedCostUsd: 0.1, successfulRequests: 2, reportedTokens: 100 },
        { estimatedCostUsd: 0.1001234567894, successfulRequests: 3, reportedTokens: 250 },
      ),
    ).toBe(0.000123456789);
  });

  it('records zero for no provider call and null when a paid success omits usage', () => {
    const before = { estimatedCostUsd: 0.1, successfulRequests: 2, reportedTokens: 100 };
    expect(billingDelta(before, before)).toBe(0);
    expect(
      billingDelta(before, { ...before, successfulRequests: before.successfulRequests + 1 }),
    ).toBeNull();
  });
});
