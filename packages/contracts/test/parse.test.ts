import { describe, expect, it } from 'vitest';

import {
  ingestionPayloadSchema,
  knowledgeQueryRequestSchema,
  knowledgeQueryResponseSchema,
  parseRequestSchema,
  parseResponseSchema,
} from '../src';

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
    const oversizedElements: Array<{ text: string; elementType: string }> = [];
    for (let index = 0; index < 100_001; index += 1) oversizedElements.push(element);
    expect(() =>
      parseResponseSchema.parse({
        parser: 'text',
        parserVersion: '1.1.0',
        elements: oversizedElements,
      }),
    ).toThrow();
  });
});

describe('knowledge query contract', () => {
  it('normalizes valid questions and rejects control characters or trusted fields', () => {
    expect(knowledgeQueryRequestSchema.parse({ question: ' 付款周期？ ' })).toEqual({
      question: '付款周期？',
    });
    expect(() => knowledgeQueryRequestSchema.parse({ question: 'a\0b' })).toThrow();
    expect(() =>
      knowledgeQueryRequestSchema.parse({ question: '付款周期？', tenantId: 'forged' }),
    ).toThrow();
  });

  it('accepts grounded and explicit no-answer responses', () => {
    expect(
      knowledgeQueryResponseSchema.parse({
        answer: '付款周期是 30 天。[来源1]',
        noAnswer: false,
        reason: null,
        traceId: id,
        sources: [
          {
            index: 1,
            documentId: id,
            documentVersion: 1,
            chunkIds: ['a'.repeat(64)],
            sourceName: 'policy.md',
            page: 2,
            sheet: null,
            sectionPath: ['付款制度'],
          },
        ],
        model: { provider: 'deepseek', model: 'chat', fallbackUsed: false },
        rerankDegraded: false,
      }),
    ).toMatchObject({ noAnswer: false });
    expect(
      knowledgeQueryResponseSchema.parse({
        answer: '没有找到足够依据。',
        noAnswer: true,
        reason: 'insufficient_relevance',
        traceId: id,
        sources: [],
        model: null,
        rerankDegraded: false,
      }),
    ).toMatchObject({ noAnswer: true, sources: [] });
    expect(() =>
      knowledgeQueryResponseSchema.parse({
        answer: '没有找到足够依据。',
        noAnswer: true,
        reason: null,
        traceId: id,
        sources: [],
        model: null,
        rerankDegraded: false,
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
    expect(
      ingestionPayloadSchema.parse({
        ...reference,
        storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.dxf',
      }),
    ).toMatchObject({ storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.dxf' });
    expect(
      ingestionPayloadSchema.parse({
        ...reference,
        storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.dwg',
      }),
    ).toMatchObject({ storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.dwg' });
    expect(() => ingestionPayloadSchema.parse({ ...reference, content: 'secret' })).toThrow();
    expect(() => ingestionPayloadSchema.parse({ ...reference, tenantId: 'forged' })).toThrow();
  });
});
