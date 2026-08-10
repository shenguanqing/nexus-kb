import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, apiTextRequest } from './client';

afterEach(() => vi.restoreAllMocks());

describe('apiRequest', () => {
  it('validates successful responses at runtime', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await expect(apiRequest('/test', z.object({ ok: z.literal(true) }))).resolves.toEqual({
      ok: true,
    });
  });

  it('maps structured API errors without exposing raw responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'FORBIDDEN', message: '无权限', traceId: 'trace-1' } }),
          {
            status: 403,
          },
        ),
      ),
    );
    await expect(apiRequest('/test', z.object({}))).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      traceId: 'trace-1',
    });
  });

  it('loads authorized text preview content with cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('# 制度', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiTextRequest('/preview')).resolves.toBe('# 制度');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });
});
