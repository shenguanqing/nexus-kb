import { describe, expect, it } from 'vitest';

import { ingestionJobListRequestSchema, ingestionJobSchema } from '../src/ingestion';

describe('ingestion contracts', () => {
  it('accepts bounded task filters without identity fields', () => {
    expect(
      ingestionJobListRequestSchema.parse({ status: 'failed', page: '2', pageSize: '50' }),
    ).toMatchObject({
      status: 'failed',
      page: 2,
      pageSize: 50,
    });
    expect(ingestionJobListRequestSchema.safeParse({ tenantId: 'forged' }).success).toBe(false);
  });

  it('validates bodyless task details', () => {
    const timestamp = '2026-07-18T06:00:00.000Z';
    expect(
      ingestionJobSchema.parse({
        id: 'a5427e4a-b9db-4750-8dfd-02d601a41473',
        documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        sourceName: 'fixture.txt',
        mimeType: 'text/plain',
        version: 1,
        kind: 'ingestion',
        status: 'failed',
        step: 'failed',
        checkpoint: 'queued',
        attempts: 3,
        traceId: 'd26720b3-1f78-40df-868d-8ca8510dca26',
        parserVersion: null,
        embeddingFingerprint: null,
        warnings: [],
        errorCode: 'PROVIDER_UNAVAILABLE',
        errorCategory: 'embedding',
        retryable: true,
        startedAt: timestamp,
        completedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).retryable,
    ).toBe(true);
  });
});
