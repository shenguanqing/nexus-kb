import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProviderStatuses, getSystemStatus } from './system';

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
});
