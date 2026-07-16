import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../src/config/app-config';
import { ParserClient } from '../src/parser/parser-client';

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
        PARSER_INTERNAL_TOKEN: 'internal-test-token',
        PARSER_REQUEST_TIMEOUT_MS: 1_000,
      },
    } as AppConfig;
    await expect(
      new ParserClient(config).parse(
        { jobId: id, documentId: id, storagePath: '/data/raw-docs/a.txt', mimeType: 'text/plain' },
        id,
      ),
    ).rejects.toThrow();
  });
});
