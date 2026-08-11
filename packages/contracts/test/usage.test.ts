import { describe, expect, it } from 'vitest';

import { usageProviderRowSchema } from '../src/usage';

describe('usage contracts', () => {
  it('accepts a zero-request row for the currently configured embedding model', () => {
    expect(
      usageProviderRowSchema.parse({
        kind: 'embedding',
        provider: 'google',
        model: 'gemini-embedding-001',
        requests: 0,
        failures: 0,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
      }),
    ).toMatchObject({ provider: 'google', model: 'gemini-embedding-001', requests: 0 });
  });
});
