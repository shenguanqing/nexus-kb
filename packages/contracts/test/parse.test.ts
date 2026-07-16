import { describe, expect, it } from 'vitest';

import { ingestionPayloadSchema, parseRequestSchema, parseResponseSchema } from '../src';

const id = 'd26720b3-1f78-40df-868d-8ca8510dca26';

describe('parser contract', () => {
  it('accepts the version one response shape', () => {
    const response = parseResponseSchema.parse({
      parser: 'text',
      parserVersion: '1.0.0',
      elements: [{ text: 'hello', elementType: 'paragraph' }],
    });

    expect(response.elements[0]?.sectionPath).toEqual([]);
    expect(response.warnings).toEqual([]);
  });

  it('rejects unknown trusted fields and empty results', () => {
    expect(() =>
      parseRequestSchema.parse({
        jobId: id,
        documentId: id,
        storagePath: '/data/raw-docs/document.txt',
        mimeType: 'text/plain',
        tenantId: 'untrusted',
      }),
    ).toThrow();
    expect(() =>
      parseResponseSchema.parse({ parser: 'text', parserVersion: '1.0.0', elements: [] }),
    ).toThrow();
  });

  it('rejects wrong element types and oversized responses', () => {
    expect(() =>
      parseResponseSchema.parse({
        parser: 'text',
        parserVersion: '1.1.0',
        elements: [{ text: 'hello', elementType: 42 }],
      }),
    ).toThrow();
    const element = { text: 'x', elementType: 'paragraph' };
    expect(() =>
      parseResponseSchema.parse({
        parser: 'text',
        parserVersion: '1.1.0',
        elements: Array.from({ length: 100_001 }, () => element),
      }),
    ).toThrow();
  });
});

describe('ingestion queue contract', () => {
  it('accepts references but rejects file content and identity fields', () => {
    const reference = {
      ingestionJobId: 'a5427e4a-b9db-4750-8dfd-02d601a41473',
      documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.txt',
    };
    expect(ingestionPayloadSchema.parse(reference)).toEqual(reference);
    expect(() => ingestionPayloadSchema.parse({ ...reference, content: 'secret' })).toThrow();
    expect(() => ingestionPayloadSchema.parse({ ...reference, tenantId: 'forged' })).toThrow();
  });
});
