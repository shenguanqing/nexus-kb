import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSystemConfiguration,
  getProviderStatuses,
  getSystemConfiguration,
  getSystemStatus,
} from './system';

afterEach(() => vi.restoreAllMocks());

describe('system API', () => {
  it('validates provider summaries without sending client identity fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          providers: [],
          syntheticCheck: { status: 'not_configured', checkedAt: null },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getProviderStatuses();

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/system/providers',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('tenant');
  });

  it('fails closed when the system status response contains an internal endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'ready',
            checkedAt: '2026-07-18T00:00:00.000Z',
            components: [],
            ingestionQueue: {
              status: 'up',
              waiting: 0,
              active: 0,
              delayed: 0,
              failed: 0,
              oldestWaitSeconds: 0,
            },
            rawDocsDiskUsageRatio: 0.25,
            internalEndpoint: 'postgres://internal',
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(getSystemStatus()).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });

  it('submits only the configuration patch and write-only secret fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '00000000-0000-4000-8000-000000000001',
          version: 1,
          status: 'draft',
          values: {},
          secretConfigured: {},
          changedKeys: ['LLM_MODEL'],
          changeReason: '更新模型',
          createdBy: 'admin-a',
          createdAt: '2026-08-04T08:00:00.000Z',
          activatedAt: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createSystemConfiguration({
      values: { LLM_MODEL: 'model-b' },
      secrets: { OPENAI_API_KEY: 'write-only-key' },
      changeReason: '更新模型',
    }).catch(() => undefined);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(typeof request.body).toBe('string');
    const requestBody = typeof request.body === 'string' ? request.body : '';
    expect(JSON.parse(requestBody)).toEqual({
      values: { LLM_MODEL: 'model-b' },
      secrets: { OPENAI_API_KEY: 'write-only-key' },
      changeReason: '更新模型',
    });
    expect(requestBody).not.toContain('tenantId');
    expect(requestBody).not.toContain('services');
  });

  it('rejects a configuration response that accidentally returns a secret', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            deploymentAgentAvailable: true,
            embeddingManagedSeparately: true,
            effectiveValues: {},
            secretConfigured: {},
            current: null,
            versions: [],
            OPENAI_API_KEY: 'must-not-be-returned',
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(getSystemConfiguration()).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });
});
