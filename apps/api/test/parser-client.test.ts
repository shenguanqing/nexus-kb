import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { ParserClient } from '../src/parser/parser-client';
import type { ParserError } from '../src/parser/parser-error';

const id = 'd26720b3-1f78-40df-868d-8ca8510dca26';

describe('ParserClient contract validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a valid Worker response and sends internal authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          parser: 'text',
          parserVersion: '1.0.0',
          elements: [{ text: 'hello', elementType: 'paragraph' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;
    const result = await new ParserClient(config).parse(
      { jobId: id, documentId: id, storagePath: '/data/raw-docs/a.txt', mimeType: 'text/plain' },
      id,
    );

    expect(result.elements[0]?.text).toBe('hello');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('x-internal-token')).toBe('internal-test-token');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://parser-worker:8000/internal/v1/parse',
    );
  });

  it('rejects an invalid Worker response at runtime', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ parser: 'text', elements: [] }), { status: 200 }),
        ),
    );
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;
    await expect(
      new ParserClient(config).parse(
        { jobId: id, documentId: id, storagePath: '/data/raw-docs/a.txt', mimeType: 'text/plain' },
        id,
      ),
    ).rejects.toMatchObject({ code: 'PARSER_INVALID_RESPONSE', retryable: false });
  });

  it('rejects a preview artifact belonging to another document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            parser: 'python-docx',
            parserVersion: '1.1.0',
            elements: [{ text: 'hello', elementType: 'paragraph' }],
            preview: {
              storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.pdf',
              kind: 'pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1024,
              renderer: 'libreoffice',
              rendererVersion: '25.2.4',
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;

    await expect(
      new ParserClient(config).parse(
        { jobId: id, documentId: id, storagePath: '/data/raw-docs/a.docx', mimeType: 'docx' },
        id,
      ),
    ).rejects.toMatchObject({ code: 'PARSER_INVALID_RESPONSE', retryable: false });
  });

  it('accepts a document-bound CAD tile bundle and requests detail tiles from the native worker', async () => {
    const bundleId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          storageKey: `${id}.cad/bundles/${bundleId}/tiles/8/255/127.png`,
          mimeType: 'image/png',
          sizeBytes: 4096,
          cacheHit: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
        CAD_PREVIEW_RENDER_TIMEOUT_SECONDS: 60,
      },
    } as AppConfig;

    await expect(
      new ParserClient(config).ensureCadPreviewTile(
        { documentId: id, zoom: 8, tileX: 255, tileY: 127 },
        id,
      ),
    ).resolves.toMatchObject({ cacheHit: false, sizeBytes: 4096 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://parser-worker:8000/internal/v1/cad-preview/tile',
    );
  });

  it('accepts a CAD tile preview artifact using the .cad storage suffix', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            parser: 'ezdxf',
            parserVersion: '1.4.4',
            elements: [{ text: 'LINE', elementType: 'cad_entity' }],
            preview: {
              storageKey: `${id}.cad`,
              kind: 'cad_tiles',
              mimeType: 'application/vnd.nexuskb.cad-tiles+json',
              sizeBytes: 4096,
              renderer: 'ezdxf-cad-tiles',
              rendererVersion: '1',
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;

    await expect(
      new ParserClient(config).parse(
        {
          jobId: id,
          documentId: id,
          storagePath: '/data/raw-docs/a.dxf',
          mimeType: 'image/vnd.dxf',
        },
        id,
      ),
    ).resolves.toMatchObject({ preview: { kind: 'cad_tiles' } });
  });

  it('classifies temporary Worker failures as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;

    await expect(
      new ParserClient(config).parse(
        { jobId: id, documentId: id, storagePath: '/data/raw-docs/a.txt', mimeType: 'text/plain' },
        id,
      ),
    ).rejects.toMatchObject({
      code: 'PARSER_UNAVAILABLE',
      retryable: true,
    } satisfies Partial<ParserError>);
  });

  it('classifies a DWG conversion gateway timeout as retryable timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 504 }));
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;

    await expect(
      new ParserClient(config).parse(
        {
          jobId: id,
          documentId: id,
          storagePath: '/data/raw-docs/a.dwg',
          mimeType: 'image/vnd.dwg',
        },
        id,
      ),
    ).rejects.toMatchObject({
      code: 'PARSER_TIMEOUT',
      retryable: true,
    } satisfies Partial<ParserError>);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'http://parser-worker-dwg:8000/internal/v1/parse',
    );
  });

  it('preserves allowlisted safe Worker error codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'CAD 实体数量超过限制' }), {
          status: 422,
          headers: { 'x-parser-error-code': 'CAD_ENTITY_LIMIT_EXCEEDED' },
        }),
      ),
    );
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;

    await expect(
      new ParserClient(config).parse(
        {
          jobId: id,
          documentId: id,
          storagePath: '/data/raw-docs/a.dwg',
          mimeType: 'image/vnd.dwg',
        },
        id,
      ),
    ).rejects.toMatchObject({
      code: 'CAD_ENTITY_LIMIT_EXCEEDED',
      retryable: false,
    } satisfies Partial<ParserError>);
  });

  it('does not retry Worker authentication failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const config = {
      values: {
        PARSER_WORKER_URL: 'http://parser-worker:8000',
        PARSER_DWG_WORKER_URL: 'http://parser-worker-dwg:8000',
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;

    await expect(
      new ParserClient(config).parse(
        { jobId: id, documentId: id, storagePath: '/data/raw-docs/a.txt', mimeType: 'text/plain' },
        id,
      ),
    ).rejects.toMatchObject({
      code: 'PARSER_AUTHENTICATION_FAILED',
      retryable: false,
    } satisfies Partial<ParserError>);
  });
});
