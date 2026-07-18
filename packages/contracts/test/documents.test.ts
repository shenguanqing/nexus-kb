import { describe, expect, it } from 'vitest';

import {
  documentDetailSchema,
  documentListRequestSchema,
  documentListResponseSchema,
  documentUploadOptionsSchema,
} from '../src/documents';

describe('document contracts', () => {
  it('coerces bounded pagination and rejects unknown query fields', () => {
    expect(
      documentListRequestSchema.parse({ page: '2', pageSize: '25', search: ' 制度 ' }),
    ).toMatchObject({ page: 2, pageSize: 25, search: '制度' });
    expect(documentListRequestSchema.safeParse({ tenantId: 'forged' }).success).toBe(false);
    expect(documentListRequestSchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('validates list and server-owned upload option responses', () => {
    const timestamp = '2026-07-18T06:00:00.000Z';
    expect(
      documentListResponseSchema.parse({
        items: [
          {
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            sourceName: '制度.md',
            mimeType: 'text/markdown',
            department: 'finance',
            sensitivity: 'internal',
            ownerId: 'user-a',
            activeVersion: 1,
            status: 'active',
            latestJob: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      }).total,
    ).toBe(1);
    expect(
      documentUploadOptionsSchema.parse({
        maxUploadBytes: 1024,
        acceptedExtensions: ['txt', 'md'],
        department: 'finance',
        allowedSensitivities: ['internal'],
        defaultSensitivity: 'internal',
        dwgConversionEnabled: false,
      }).acceptedExtensions,
    ).toEqual(['txt', 'md']);
  });

  it('validates document detail without parsed content or storage paths', () => {
    const timestamp = '2026-07-18T06:00:00.000Z';
    expect(
      documentDetailSchema.parse({
        id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        sourceName: '制度.md',
        mimeType: 'text/markdown',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'user-a',
        activeVersion: 1,
        status: 'active',
        versions: [
          {
            version: 1,
            status: 'active',
            parser: 'markdown',
            parserVersion: '1.0',
            warnings: [],
            chunkCount: 3,
            embeddingFingerprint: 'a'.repeat(64),
            indexedAt: timestamp,
            activatedAt: timestamp,
            supersededAt: null,
            createdAt: timestamp,
          },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      }).versions[0]?.chunkCount,
    ).toBe(3);
  });
});
