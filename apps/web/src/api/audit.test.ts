import { afterEach, describe, expect, it, vi } from 'vitest';

import { listAuditEvents } from './audit';

afterEach(() => vi.restoreAllMocks());

describe('audit API', () => {
  it('sends only bounded audit query fields and validates the response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ events: [], nextBefore: null }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await listAuditEvents({ type: 'query', limit: 25 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/v1/audit/events?type=query&limit=25');
    expect(url).not.toContain('tenant');
  });

  it('rejects unsupported client-side identity filters before requesting', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() => listAuditEvents({ tenantId: 'tenant-b' } as never)).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
