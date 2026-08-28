import { describe, expect, it } from 'vitest';

import {
  documentChunkListRequestSchema,
  documentChunkListResponseSchema,
  documentDetailSchema,
  documentListRequestSchema,
  documentListResponseSchema,
  documentPreviewSchema,
  documentUploadOptionsSchema,
} from '../src/documents';

describe('document contracts', () => {
  it('coerces bounded pagination and rejects unknown query fields', () => {
    expect(
      documentListRequestSchema.parse({ page: '2', pageSize: '25', search: ' 制度 ' }),
    ).toMatchObject({
      page: 2,
      pageSize: 25,
      search: '制度',
    });
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
        acceptedExtensions: ['txt', 'md', 'doc'],
        department: 'finance',
        allowedSensitivities: ['internal'],
        defaultSensitivity: 'internal',
        dwgConversionEnabled: false,
      }).acceptedExtensions,
    ).toEqual(['txt', 'md', 'doc']);
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
            vectorCollection: 'nexus_ollama_bge_m3_1024_12345678',
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

  it('validates paginated ACL-authorized chunk details', () => {
    const timestamp = '2026-07-22T09:00:00.000Z';
    expect(
      documentChunkListResponseSchema.parse({
        documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        sourceName: '制度.md',
        documentVersion: 1,
        items: [
          {
            id: 'a'.repeat(64),
            documentVersion: 1,
            ordinal: 0,
            originalText: '原始内容',
            redactedText: '脱敏内容',
            tokenCount: 4,
            page: 1,
            sheet: null,
            sectionPath: ['第一章'],
            elementTypes: ['paragraph'],
            previousChunkId: null,
            nextChunkId: null,
            redactionPolicyVersion: 'v1',
            redactionSummary: { EMAIL: 1 },
            createdAt: timestamp,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      }).items[0]?.originalText,
    ).toBe('原始内容');
    expect(documentChunkListRequestSchema.parse({ version: '2' })).toMatchObject({
      version: 2,
      page: 1,
      pageSize: 20,
    });
    expect(documentChunkListRequestSchema.safeParse({ tenantId: 'forged' }).success).toBe(false);
  });

  it('validates a path-free document preview manifest', () => {
    expect(
      documentPreviewSchema.parse({
        documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        sourceName: '制度.docx',
        sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        status: 'ready',
        kind: 'pdf',
        contentType: 'application/pdf',
        renderer: 'libreoffice',
        rendererVersion: '25.2.4',
        generatedAt: '2026-08-09T08:00:00.000Z',
        fallbackVersion: null,
        cad: null,
      }).kind,
    ).toBe('pdf');
    expect(
      documentPreviewSchema.safeParse({
        documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        sourceName: '制度.docx',
        sourceMimeType: 'application/octet-stream',
        status: 'ready',
        kind: 'pdf',
        contentType: 'application/pdf',
        renderer: null,
        rendererVersion: null,
        generatedAt: null,
        fallbackVersion: null,
        cad: null,
        storagePath: '/data/previews/document.pdf',
      }).success,
    ).toBe(false);
  });

  it('validates a CAD tile manifest with an explicit world-to-pixel transform', () => {
    const preview = documentPreviewSchema.parse({
      documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      sourceName: '厂区平面图.dxf',
      sourceMimeType: 'image/vnd.dxf',
      status: 'ready',
      kind: 'cad_tiles',
      contentType: 'application/vnd.nexuskb.cad-tiles+json',
      renderer: 'ezdxf-cad-tiles',
      rendererVersion: '1',
      generatedAt: '2026-08-09T08:00:00.000Z',
      fallbackVersion: null,
      cad: {
        strategy: 'tiles',
        tileSize: 512,
        minZoom: 0,
        maxZoom: 15,
        baseWidth: 512,
        baseHeight: 256,
        overviewWidth: 1600,
        overviewHeight: 800,
        bounds: { minX: 100, minY: 200, maxX: 1100, maxY: 700 },
        focusBounds: { minX: 200, minY: 250, maxX: 600, maxY: 500 },
        worldToPixel: [0.512, 0, 0, -0.512, -51.2, 358.4],
        entityCount: 120000,
        renderCostScore: 480000,
      },
    });

    expect(preview.cad?.worldToPixel).toHaveLength(6);
    expect(preview.cad?.focusBounds).toEqual({
      minX: 200,
      minY: 250,
      maxX: 600,
      maxY: 500,
    });
    expect(
      documentPreviewSchema.safeParse({
        ...preview,
        cad: {
          ...preview.cad,
          focusBounds: { minX: 0, minY: 250, maxX: 600, maxY: 500 },
        },
      }).success,
    ).toBe(false);
    expect(
      documentPreviewSchema.safeParse({ ...preview, kind: 'svg', cad: preview.cad }).success,
    ).toBe(false);
  });
});
