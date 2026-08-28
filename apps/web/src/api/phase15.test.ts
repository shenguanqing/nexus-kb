import { afterEach, describe, expect, it, vi } from 'vitest';
import { listDepartments, updateUserRoles } from './access';
import { listConversations } from './history';
import { fetchUsage } from './usage';

afterEach(() => vi.restoreAllMocks());

describe('remaining phase 15 APIs', () => {
  it('keeps history ownership implicit and rejects tenant filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ conversations: [], total: 0, offset: 0, limit: 20 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await listConversations({ query: '付款' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/history/conversations?query=%E4%BB%98%E6%AC%BE&offset=0&limit=20',
    );
    expect(() => listConversations({ tenantId: 'tenant-b' } as never)).toThrow();
  });

  it('validates role mutations and department responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ departments: [], scope: 'tenant' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await listDepartments();
    expect(() => updateUserRoles('user-a', ['root' as never])).toThrow();
  });

  it('requests bounded usage ranges', async () => {
    const payload = {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-20T00:00:00.000Z',
      totalQueries: 0,
      failureRate: null,
      queryP50Ms: null,
      queryP95Ms: null,
      providers: [],
      departments: [],
      usageCompleteness: 'request_only',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchUsage(payload.from, payload.to);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/system/usage?');
  });
});
