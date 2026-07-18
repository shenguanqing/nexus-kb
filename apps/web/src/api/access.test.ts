import { afterEach, describe, expect, it, vi } from 'vitest';

import { listUsers } from './access';

afterEach(() => vi.restoreAllMocks());

describe('access API', () => {
  it('sends bounded directory filters without identity scope fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ users: [], total: 0, offset: 0, limit: 25, scope: 'tenant' }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await listUsers({ query: 'alice', department: 'finance' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/v1/access/users?query=alice&department=finance&offset=0&limit=25');
    expect(url).not.toContain('tenantId');
  });

  it('rejects client-provided tenant scope before requesting', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() => listUsers({ tenantId: 'tenant-b' } as never)).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
