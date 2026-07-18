import { afterEach, describe, expect, it, vi } from 'vitest';

import { listDocuments, uploadDocument } from './documents';

afterEach(() => vi.restoreAllMocks());

describe('documents API', () => {
  it('sends only validated list filters and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], page: 2, pageSize: 20, total: 0 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listDocuments({ search: '制度', page: 2, pageSize: 20 })).resolves.toMatchObject({
      page: 2,
      total: 0,
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('search=%E5%88%B6%E5%BA%A6');
    expect(url).not.toContain('tenant');
  });

  it('uploads only the selected file in multipart form data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
          jobId: 'a5427e4a-b9db-4750-8dfd-02d601a41473',
          status: 'queued',
          traceId: 'd26720b3-1f78-40df-868d-8ca8510dca26',
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await uploadDocument(new File(['safe fixture'], 'fixture.txt', { type: 'text/plain' }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect([...(init.body as FormData).keys()]).toEqual(['file']);
  });
});
