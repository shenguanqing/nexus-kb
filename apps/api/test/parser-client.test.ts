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
    ).rejects.toMatchObject({ code: 'PARSER_INVALID_RESPONSE', retryable: false });
  });

  it('classifies temporary Worker failures as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
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
    ).rejects.toMatchObject({
      code: 'PARSER_UNAVAILABLE',
      retryable: true,
    } satisfies Partial<ParserError>);
  });

  it('does not retry Worker authentication failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
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
    ).rejects.toMatchObject({
      code: 'PARSER_AUTHENTICATION_FAILED',
      retryable: false,
    } satisfies Partial<ParserError>);
  });
});
