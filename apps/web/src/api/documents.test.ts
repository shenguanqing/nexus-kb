import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  documentPreviewOverviewUrl,
  documentPreviewTileUrl,
  fetchDocumentPreview,
  listDocumentChunks,
  listDocuments,
  uploadDocument,
} from './documents';

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

  it("requests a selected document version's chunks with server-side pagination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
          sourceName: '制度.md',
          documentVersion: 2,
          items: [],
          page: 3,
          pageSize: 20,
          total: 40,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listDocumentChunks('6769af9a-a4d0-4dc2-a97d-942584a9c826', {
        version: 2,
        page: 3,
        pageSize: 20,
      }),
    ).resolves.toMatchObject({ documentVersion: 2, total: 40 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/documents/6769af9a-a4d0-4dc2-a97d-942584a9c826/chunks?version=2&page=3&pageSize=20',
    );
  });

  it('loads a path-free preview manifest', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
          sourceName: '制度.pdf',
          sourceMimeType: 'application/pdf',
          status: 'ready',
          kind: 'pdf',
          contentType: 'application/pdf',
          renderer: 'browser-native',
          rendererVersion: null,
          generatedAt: null,
          fallbackVersion: null,
          cad: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchDocumentPreview('6769af9a-a4d0-4dc2-a97d-942584a9c826'),
    ).resolves.toMatchObject({
      status: 'ready',
      kind: 'pdf',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/documents/6769af9a-a4d0-4dc2-a97d-942584a9c826/preview',
    );
  });

  it('builds encoded CAD overview and integer tile URLs', () => {
    expect(documentPreviewOverviewUrl('document/id')).toBe(
      '/v1/documents/document%2Fid/preview/overview',
    );
    expect(documentPreviewTileUrl('document/id', 8, 255, 127)).toBe(
      '/v1/documents/document%2Fid/preview/tiles/8/255/127',
    );
  });
});
