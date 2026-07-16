import { describe, expect, it } from 'vitest';

import { parseRequestSchema, parseResponseSchema } from '../src';

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
});
