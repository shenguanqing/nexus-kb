import { describe, expect, it } from 'vitest';

import {
  systemConfigurationUpdateRequestSchema,
  systemDeploymentSchema,
} from '../src/system-configuration';

describe('system configuration contracts', () => {
  it('accepts managed runtime fields and write-only secrets', () => {
    expect(
      systemConfigurationUpdateRequestSchema.parse({
        values: { LLM_PROVIDER: 'google', LLM_MODEL: 'gemini-model' },
        secrets: { GEMINI_API_KEY: 'write-only-value' },
        changeReason: '切换主模型',
      }),
    ).toMatchObject({ values: { LLM_PROVIDER: 'google' } });
  });

  it('rejects embedding fields from the ordinary restart workflow', () => {
    expect(() =>
      systemConfigurationUpdateRequestSchema.parse({
        values: { EMBEDDING_MODEL: 'unsafe-direct-change' },
        changeReason: '绕过索引迁移',
      }),
    ).toThrow();
  });

  it('requires a bounded deployment service allowlist', () => {
    expect(() =>
      systemDeploymentSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        status: 'running',
        services: ['postgres'],
        configVersion: 1,
        previousVersion: null,
        rollbackAvailable: false,
        errorCode: null,
        createdAt: '2026-08-04T08:00:00.000Z',
        startedAt: null,
        completedAt: null,
      }),
    ).toThrow();
  });
});
