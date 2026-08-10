import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { MultipartFile } from '@fastify/multipart';
import { describe, expect, it, vi } from 'vitest';

import { AclPolicy } from '../src/auth/acl-policy';
import type { Identity } from '../src/auth/identity';
import type { OperationalLogger } from '../src/common/operational-logger';
import { DocumentsService } from '../src/documents/documents.service';
import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';
import type { IngestionQueue } from '../src/ingestion/ingestion.queue';
import type { ParserClient } from '../src/parser/parser-client';
import type { ChromaVectorStore } from '../src/vector-store/chroma-vector-store';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: ['user'],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read', 'documents:write', 'documents:delete'],
  defaultSensitivity: 'internal',
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as OperationalLogger;
const acl = new AclPolicy();

describe('DocumentsService tenant isolation', () => {
  it('lists ACL-visible ingestion jobs with server-side pagination', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const service = new DocumentsService(
      {} as AppConfig,
      {
        ingestionJob: { findMany, count },
        $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
      } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.listJobs({ status: 'failed', page: 2, pageSize: 20 }, identity),
    ).resolves.toEqual({
      items: [],
      page: 2,
      pageSize: 20,
      total: 0,
    });
    const [query] = findMany.mock.calls[0] as unknown as [
      { where: { tenantId: string; document: { tenantId: string } }; skip: number; take: number },
    ];
    expect(query.where.tenantId).toBe('tenant-a');
    expect(query.where.document.tenantId).toBe('tenant-a');
    expect(query.skip).toBe(20);
  });

  it('requeues only an ACL-visible retryable failed ingestion job', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const claimJob = vi.fn().mockResolvedValue({ count: 1 });
    const updateDocument = vi.fn().mockResolvedValue({});
    const updateVersion = vi.fn().mockResolvedValue({});
    const createAudit = vi.fn().mockResolvedValue({});
    const transactionClient = {
      ingestionJob: { updateMany: claimJob },
      document: { update: updateDocument },
      documentVersion: { update: updateVersion },
      documentLifecycleAudit: { create: createAudit },
    };
    const service = new DocumentsService(
      {} as AppConfig,
      {
        ingestionJob: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'a5427e4a-b9db-4750-8dfd-02d601a41473',
            documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            version: 1,
            status: 'failed',
            step: 'failed',
            errorCode: 'EMBEDDING_UNAVAILABLE',
            errorCategory: 'embedding',
            retryable: true,
            completedAt: new Date(),
            document: {
              activeVersion: null,
              status: 'failed',
              storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.pdf',
            },
          }),
        },
        $transaction: (operation: (tx: typeof transactionClient) => Promise<unknown>) =>
          operation(transactionClient),
      } as unknown as PrismaService,
      { retry } as unknown as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.retryJob(
        'a5427e4a-b9db-4750-8dfd-02d601a41473',
        identity,
        'd26720b3-1f78-40df-868d-8ca8510dca26',
      ),
    ).resolves.toMatchObject({ status: 'queued' });
    expect(retry).toHaveBeenCalledWith('a5427e4a-b9db-4750-8dfd-02d601a41473', {
      ingestionJobId: 'a5427e4a-b9db-4750-8dfd-02d601a41473',
      documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.pdf',
    });
    const [updateInput] = claimJob.mock.calls[0] as unknown as [
      { data: { status: string; startedAt: Date | null } },
    ];
    expect(updateInput.data.status).toBe('queued');
    expect(updateInput.data.startedAt).toBeNull();
    expect(createAudit).toHaveBeenCalledOnce();
  });

  it('lists only ACL-visible documents with server-side pagination and filters', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        sourceName: '制度.md',
        mimeType: 'text/markdown',
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'user-a',
        activeVersion: 1,
        status: 'active',
        createdAt: new Date('2026-07-18T06:00:00.000Z'),
        updatedAt: new Date('2026-07-18T07:00:00.000Z'),
        jobs: [],
      },
    ]);
    const count = vi.fn().mockResolvedValue(21);
    const service = new DocumentsService(
      {} as AppConfig,
      {
        document: { findMany, count },
        $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
      } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    const result = await service.listDocuments(
      {
        search: '制度',
        format: 'md',
        sensitivity: 'internal',
        page: 2,
        pageSize: 20,
      },
      identity,
    );

    expect(result).toMatchObject({ page: 2, pageSize: 20, total: 21 });
    expect(result.items[0]?.updatedAt).toBe('2026-07-18T07:00:00.000Z');
    const [query] = findMany.mock.calls[0] as unknown as [
      {
        where: { tenantId: string; sensitivity: unknown; OR: unknown; AND: unknown[] };
        skip: number;
        take: number;
      },
    ];
    expect(query.where.tenantId).toBe('tenant-a');
    expect(query.where.OR).toEqual(
      expect.arrayContaining([{ department: 'finance' }, { ownerId: 'user-a' }]),
    );
    expect(query.where.AND).toHaveLength(2);
    expect(query.skip).toBe(20);
    expect(query.take).toBe(20);
  });

  it('returns upload options from server configuration and signed identity', () => {
    const service = new DocumentsService(
      {
        values: { MAX_UPLOAD_BYTES: 4096, DWG_CONVERSION_ENABLED: false },
      } as unknown as AppConfig,
      {} as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    expect(service.getUploadOptions(identity)).toEqual({
      maxUploadBytes: 4096,
      acceptedExtensions: ['txt', 'md', 'docx', 'xlsx', 'pdf', 'png', 'jpg', 'jpeg', 'dxf'],
      department: 'finance',
      allowedSensitivities: ['public', 'internal'],
      defaultSensitivity: 'internal',
      dwgConversionEnabled: false,
    });
  });

  it('queues a new version without changing the active document', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const createVersion = vi.fn().mockResolvedValue({});
    const createJob = vi.fn().mockResolvedValue({});
    const createAudit = vi.fn().mockResolvedValue({});
    const service = new DocumentsService(
      {} as AppConfig,
      {
        document: {
          findFirst: vi.fn().mockResolvedValue({
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.md',
            activeVersion: 1,
            status: 'active',
            versions: [{ version: 1 }],
          }),
        },
        ingestionJob: { findFirst: vi.fn().mockResolvedValue(null), create: createJob },
        documentVersion: { create: createVersion },
        documentLifecycleAudit: { create: createAudit },
        $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
      } as unknown as PrismaService,
      { enqueue } as unknown as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    const result = await service.reindexDocument(
      '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      identity,
      'd26720b3-1f78-40df-868d-8ca8510dca26',
    );

    expect(result).toMatchObject({ documentVersion: 2, status: 'queued' });
    const [versionInput] = createVersion.mock.calls[0] as unknown as [
      { data: { version: number; status: string } },
    ];
    const [jobInput] = createJob.mock.calls[0] as unknown as [
      { data: { version: number; kind: string } },
    ];
    expect(versionInput.data).toMatchObject({ version: 2, status: 'processing' });
    expect(jobInput.data).toMatchObject({ version: 2, kind: 'reindex' });
    expect(createAudit).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.md',
      }),
    );
  });

  it('resumes a prepared document from its saved local chunks', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const updateJob = vi.fn().mockResolvedValue({ count: 1 });
    const updateDocument = vi.fn().mockResolvedValue({});
    const updateVersion = vi.fn().mockResolvedValue({});
    const createAudit = vi.fn().mockResolvedValue({});
    const transactionClient = {
      ingestionJob: { updateMany: updateJob },
      document: { update: updateDocument },
      documentVersion: { update: updateVersion },
      documentLifecycleAudit: { create: createAudit },
    };
    const service = new DocumentsService(
      {} as AppConfig,
      {
        document: {
          findFirst: vi.fn().mockResolvedValue({
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.md',
            activeVersion: null,
            status: 'prepared',
            versions: [{ version: 1 }],
          }),
        },
        ingestionJob: {
          findFirst: vi.fn().mockResolvedValue({ id: 'a5427e4a-b9db-4750-8dfd-02d601a41473' }),
        },
        $transaction: (
          operation: ((tx: typeof transactionClient) => Promise<unknown>) | Array<Promise<unknown>>,
        ) =>
          typeof operation === 'function' ? operation(transactionClient) : Promise.all(operation),
      } as unknown as PrismaService,
      { enqueue } as unknown as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.reindexDocument(
        '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        identity,
        'd26720b3-1f78-40df-868d-8ca8510dca26',
      ),
    ).resolves.toMatchObject({ documentVersion: 1, status: 'queued' });

    const [[jobUpdateInput]] = updateJob.mock.calls as unknown as [
      [{ data: { checkpoint: string } }],
    ];
    const [[auditInput]] = createAudit.mock.calls as unknown as [[{ data: { eventType: string } }]];
    expect(jobUpdateInput.data.checkpoint).toBe('local_prepared');
    expect(auditInput.data.eventType).toBe('document_prepared_index_resume_requested');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ ingestionJobId: 'a5427e4a-b9db-4750-8dfd-02d601a41473' }),
    );
  });

  it('always scopes document reads to the authenticated tenant', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new DocumentsService(
      {} as AppConfig,
      { document: { findFirst } } as unknown as PrismaService,
      {} as IngestionQueue,
      { deleteDocument: () => Promise.resolve() } as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.getDocument('6769af9a-a4d0-4dc2-a97d-942584a9c826', identity),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_FOUND',
    });
    const [query] = findFirst.mock.calls[0] as unknown as [
      { where: { tenantId: string; sensitivity: unknown; OR: unknown } },
    ];
    expect(query.where.tenantId).toBe('tenant-a');
    expect(query.where.sensitivity).toEqual({ in: ['public', 'internal'] });
    expect(query.where.OR).toEqual(
      expect.arrayContaining([{ department: 'finance' }, { ownerId: 'user-a' }]),
    );
  });

  it('returns vector collection metadata only with an ACL-visible document detail', async () => {
    const timestamp = new Date('2026-07-22T09:00:00.000Z');
    const findFirst = vi.fn().mockResolvedValue({
      id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      sourceName: '制度.md',
      mimeType: 'text/markdown',
      department: 'finance',
      sensitivity: 'internal',
      ownerId: 'user-a',
      activeVersion: 1,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
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
    });
    const service = new DocumentsService(
      {} as AppConfig,
      { document: { findFirst } } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.getDocument('6769af9a-a4d0-4dc2-a97d-942584a9c826', identity),
    ).resolves.toMatchObject({
      versions: [{ vectorCollection: 'nexus_ollama_bge_m3_1024_12345678' }],
    });
    const [query] = findFirst.mock.calls[0] as unknown as [
      { select: { versions: { select: { vectorCollection: boolean } } } },
    ];
    expect(query.select.versions.select.vectorCollection).toBe(true);
  });

  it('lists complete chunk details only after document ACL and tenant checks', async () => {
    const timestamp = new Date('2026-07-22T09:00:00.000Z');
    const findFirst = vi.fn().mockResolvedValue({
      id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      sourceName: '制度.md',
      activeVersion: 2,
      versions: [{ version: 2 }, { version: 1 }],
    });
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a'.repeat(64),
        documentVersion: 2,
        ordinal: 20,
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
    ]);
    const count = vi.fn().mockResolvedValue(21);
    const service = new DocumentsService(
      {} as AppConfig,
      {
        document: { findFirst },
        knowledgeChunk: { findMany, count },
        $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
      } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.listDocumentChunks(
        '6769af9a-a4d0-4dc2-a97d-942584a9c826',
        { page: 2, pageSize: 20 },
        identity,
      ),
    ).resolves.toMatchObject({
      documentVersion: 2,
      page: 2,
      total: 21,
      items: [{ originalText: '原始内容', redactionSummary: { EMAIL: 1 } }],
    });
    const [chunkQuery] = findMany.mock.calls[0] as unknown as [
      {
        where: { tenantId: string; documentId: string; document: { is: { tenantId: string } } };
        skip: number;
        take: number;
      },
    ];
    expect(chunkQuery.where.tenantId).toBe('tenant-a');
    expect(chunkQuery.where.documentId).toBe('6769af9a-a4d0-4dc2-a97d-942584a9c826');
    expect(chunkQuery.where.document.is.tenantId).toBe('tenant-a');
    expect(chunkQuery.skip).toBe(20);
    expect(chunkQuery.take).toBe(20);
  });

  it('always scopes ingestion job reads to the authenticated tenant', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new DocumentsService(
      {} as AppConfig,
      { ingestionJob: { findFirst } } as unknown as PrismaService,
      {} as IngestionQueue,
      { deleteDocument: () => Promise.resolve() } as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.getJob('a5427e4a-b9db-4750-8dfd-02d601a41473', identity),
    ).rejects.toMatchObject({
      code: 'INGESTION_JOB_NOT_FOUND',
    });
    const [query] = findFirst.mock.calls[0] as unknown as [
      { where: { tenantId: string; document: { tenantId: string } } },
    ];
    expect(query.where.tenantId).toBe('tenant-a');
    expect(query.where.document.tenantId).toBe('tenant-a');
  });

  it('keeps a deleting tombstone when vector deletion fails', async () => {
    const transaction = vi.fn().mockResolvedValue([]);
    const deleteDocument = vi.fn().mockRejectedValue(new Error('chroma unavailable'));
    const updateDocument = vi.fn().mockResolvedValue({});
    const updateJobs = vi.fn().mockResolvedValue({ count: 1 });
    const service = new DocumentsService(
      { values: { RAW_DOCS_PATH: '/data/raw-docs' } } as unknown as AppConfig,
      {
        document: {
          findFirst: vi.fn().mockResolvedValue({
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.md',
            status: 'active',
            activeVersion: 1,
            versions: [],
            jobs: [],
          }),
          update: updateDocument,
        },
        ingestionJob: { updateMany: updateJobs },
        $transaction: transaction,
      } as unknown as PrismaService,
      {} as IngestionQueue,
      { deleteDocument } as unknown as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.deleteDocument('6769af9a-a4d0-4dc2-a97d-942584a9c826', identity),
    ).rejects.toThrow('chroma unavailable');
    expect(deleteDocument).toHaveBeenCalledWith('tenant-a', '6769af9a-a4d0-4dc2-a97d-942584a9c826');
    expect(transaction).toHaveBeenCalledOnce();
    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'deleting', activeVersion: null },
      }),
    );
    expect(updateJobs).toHaveBeenCalledOnce();
  });

  it('recursively removes a document-bound CAD tile bundle on deletion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexuskb-cad-delete-'));
    const rawRoot = join(directory, 'raw');
    const previewRoot = join(directory, 'previews');
    const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
    const storageKey = `${documentId}.dxf`;
    const previewStorageKey = `${documentId}.cad`;
    await mkdir(join(previewRoot, previewStorageKey, 'bundles', documentId, 'tiles', '0', '0'), {
      recursive: true,
    });
    await mkdir(rawRoot, { recursive: true });
    await writeFile(join(rawRoot, storageKey), 'dxf');
    await writeFile(join(previewRoot, `.${documentId}.cad.lock`), '');
    await writeFile(
      join(previewRoot, previewStorageKey, 'bundles', documentId, 'tiles', '0', '0', '0.png'),
      'tile',
    );
    const update = vi.fn().mockResolvedValue({});
    const service = new DocumentsService(
      {
        values: { RAW_DOCS_PATH: rawRoot, PREVIEW_ARTIFACTS_PATH: previewRoot },
      } as unknown as AppConfig,
      {
        document: {
          findFirst: vi.fn().mockResolvedValue({
            id: documentId,
            storageKey,
            previewStorageKey,
            status: 'active',
            activeVersion: 1,
            versions: [],
            jobs: [],
          }),
          update,
        },
        ingestionJob: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        documentVersion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        knowledgeChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        documentLifecycleAudit: { create: vi.fn().mockResolvedValue({}) },
        $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
      } as unknown as PrismaService,
      {} as IngestionQueue,
      { deleteDocument: vi.fn().mockResolvedValue(undefined) } as unknown as ChromaVectorStore,
      logger,
      acl,
    );

    try {
      await expect(
        service.deleteDocument(documentId, identity, 'd26720b3-1f78-40df-868d-8ca8510dca26'),
      ).resolves.toEqual({ documentId, deleted: true });
      await expect(readdir(rawRoot)).resolves.toEqual([]);
      await expect(readdir(previewRoot)).resolves.toEqual([]);
      expect(update).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('lists only failed jobs from the authenticated tenant', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new DocumentsService(
      {} as AppConfig,
      { ingestionJob: { findMany } } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(service.getFailedJobs(identity)).resolves.toEqual({ jobs: [] });
    const [query] = findMany.mock.calls[0] as unknown as [
      {
        where: {
          tenantId: string;
          status: string;
          document: { tenantId: string };
        };
        take: number;
      },
    ];
    expect(query.where.tenantId).toBe('tenant-a');
    expect(query.where.status).toBe('failed');
    expect(query.where.document.tenantId).toBe('tenant-a');
    expect(query.take).toBe(50);
  });

  it('rejects duplicate content in the same ACL scope without leaving a file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexuskb-dedup-'));
    const stream = Readable.from(['same content']) as MultipartFile['file'];
    stream.truncated = false;
    const file = {
      filename: 'duplicate.txt',
      mimetype: 'text/plain',
      file: stream,
    } as MultipartFile;
    const enqueue = vi.fn();
    const service = new DocumentsService(
      {
        values: {
          RAW_DOCS_PATH: directory,
          MAX_UPLOAD_BYTES: 1024,
        },
      } as unknown as AppConfig,
      {
        document: {
          findFirst: vi.fn().mockResolvedValue({
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
          }),
        },
      } as unknown as PrismaService,
      { enqueue } as unknown as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    try {
      await expect(
        service.upload(file, identity, 'd26720b3-1f78-40df-868d-8ca8510dca26'),
      ).rejects.toMatchObject({
        code: 'DOCUMENT_DUPLICATE',
        status: 409,
      });
      expect(enqueue).not.toHaveBeenCalled();
      await expect(readdir(directory)).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects operations when the signed identity lacks the required capability', async () => {
    const service = new DocumentsService(
      {} as AppConfig,
      {} as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    await expect(
      service.getDocument('6769af9a-a4d0-4dc2-a97d-942584a9c826', {
        ...identity,
        capabilities: [],
      }),
    ).rejects.toMatchObject({
      code: 'CAPABILITY_REQUIRED',
      status: 403,
    });
  });

  it('returns only a path-free preview manifest for an ACL-visible document', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      sourceName: '制度.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      activeVersion: 1,
      previewStorageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.pdf',
      previewKind: 'pdf',
      previewMimeType: 'application/pdf',
      previewRenderer: 'libreoffice',
      previewRendererVersion: '25.2.4',
      previewGeneratedAt: new Date('2026-08-09T08:00:00.000Z'),
      versions: [{ version: 1, chunkCount: 3 }],
    });
    const service = new DocumentsService(
      {} as AppConfig,
      { document: { findFirst } } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    const manifest = await service.getDocumentPreview(
      '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      identity,
    );

    expect(manifest).toMatchObject({ status: 'ready', kind: 'pdf' });
    expect(manifest).not.toHaveProperty('previewStorageKey');
    const [query] = findFirst.mock.calls[0] as unknown as [
      { where: { tenantId: string; OR: unknown } },
    ];
    expect(query.where.tenantId).toBe('tenant-a');
    expect(query.where.OR).toEqual(
      expect.arrayContaining([{ department: 'finance' }, { ownerId: 'user-a' }]),
    );
  });

  it('marks gzip-compressed SVG previews for HTTP content decoding', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexuskb-preview-'));
    const storageKey = '6769af9a-a4d0-4dc2-a97d-942584a9c826.svg';
    await writeFile(join(directory, storageKey), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const service = new DocumentsService(
      { values: { PREVIEW_ARTIFACTS_PATH: directory } } as unknown as AppConfig,
      {
        document: {
          findFirst: vi.fn().mockResolvedValue({
            sourceName: '图纸.dxf',
            storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.dxf',
            mimeType: 'image/vnd.dxf',
            previewStorageKey: storageKey,
            previewKind: 'svg',
            previewMimeType: 'image/svg+xml',
            previewRenderer: 'ezdxf-svg-gzip',
          }),
        },
      } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
    );

    try {
      await expect(
        service.getDocumentPreviewContent('6769af9a-a4d0-4dc2-a97d-942584a9c826', identity),
      ).resolves.toMatchObject({
        path: await realpath(join(directory, storageKey)),
        kind: 'svg',
        mimeType: 'image/svg+xml',
        contentEncoding: 'gzip',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves a bounded CAD tile only after ACL checks before and after generation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexuskb-cad-preview-'));
    const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
    const bundleId = 'd26720b3-1f78-40df-868d-8ca8510dca26';
    const storageKey = `${documentId}.cad`;
    const bundle = join(directory, storageKey, 'bundles', bundleId);
    const tileStorageKey = `${storageKey}/bundles/${bundleId}/tiles/1/0/0.png`;
    await mkdir(join(bundle, 'tiles', '1', '0'), { recursive: true });
    await writeFile(join(directory, storageKey, 'current.json'), JSON.stringify({ bundleId }));
    await writeFile(
      join(bundle, 'manifest.json'),
      JSON.stringify({
        strategy: 'tiles',
        tileSize: 512,
        minZoom: 0,
        maxZoom: 8,
        baseWidth: 512,
        baseHeight: 256,
        overviewWidth: 1600,
        overviewHeight: 800,
        bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 500 },
        worldToPixel: [0.512, 0, 0, -0.512, 0, 256],
        entityCount: 120000,
        renderCostScore: 480000,
      }),
    );
    await writeFile(join(bundle, 'overview.png'), 'overview');
    await writeFile(join(directory, tileStorageKey), 'tile');
    const visibleDocument = {
      sourceName: '厂区平面图.dxf',
      previewStorageKey: storageKey,
      previewKind: 'cad_tiles',
      previewMimeType: 'application/vnd.nexuskb.cad-tiles+json',
    };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(visibleDocument)
      .mockResolvedValueOnce({ id: documentId });
    const ensureCadPreviewTile = vi.fn().mockResolvedValue({
      storageKey: tileStorageKey,
      mimeType: 'image/png',
      sizeBytes: 4,
      cacheHit: false,
    });
    const service = new DocumentsService(
      { values: { PREVIEW_ARTIFACTS_PATH: directory } } as unknown as AppConfig,
      { document: { findFirst } } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
      { ensureCadPreviewTile } as unknown as ParserClient,
    );

    try {
      await expect(
        service.getDocumentPreviewTile(
          documentId,
          1,
          0,
          0,
          identity,
          'a5427e4a-b9db-4750-8dfd-02d601a41473',
        ),
      ).resolves.toMatchObject({
        path: await realpath(join(directory, tileStorageKey)),
        mimeType: 'image/png',
        cacheHit: false,
      });
      expect(ensureCadPreviewTile).toHaveBeenCalledWith(
        { documentId, zoom: 1, tileX: 0, tileY: 0 },
        'a5427e4a-b9db-4750-8dfd-02d601a41473',
      );
      expect(findFirst).toHaveBeenCalledTimes(2);
      const [postRenderQuery] = findFirst.mock.calls[1] as unknown as [
        { where: { tenantId: string; previewStorageKey: string; previewKind: string } },
      ];
      expect(postRenderQuery.where).toMatchObject({
        tenantId: identity.tenantId,
        previewStorageKey: storageKey,
        previewKind: 'cad_tiles',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not return a generated CAD tile after access is revoked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexuskb-cad-revoked-'));
    const documentId = '6769af9a-a4d0-4dc2-a97d-942584a9c826';
    const bundleId = 'd26720b3-1f78-40df-868d-8ca8510dca26';
    const storageKey = `${documentId}.cad`;
    const bundle = join(directory, storageKey, 'bundles', bundleId);
    const tileStorageKey = `${storageKey}/bundles/${bundleId}/tiles/0/0/0.png`;
    await mkdir(join(bundle, 'tiles', '0', '0'), { recursive: true });
    await writeFile(join(directory, storageKey, 'current.json'), JSON.stringify({ bundleId }));
    await writeFile(
      join(bundle, 'manifest.json'),
      JSON.stringify({
        strategy: 'tiles',
        tileSize: 512,
        minZoom: 0,
        maxZoom: 1,
        baseWidth: 512,
        baseHeight: 512,
        overviewWidth: 1600,
        overviewHeight: 1600,
        bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
        worldToPixel: [0.512, 0, 0, -0.512, 0, 512],
        entityCount: 1,
        renderCostScore: 1,
      }),
    );
    await writeFile(join(directory, tileStorageKey), 'tile');
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        sourceName: '厂区平面图.dxf',
        previewStorageKey: storageKey,
        previewKind: 'cad_tiles',
        previewMimeType: 'application/vnd.nexuskb.cad-tiles+json',
      })
      .mockResolvedValueOnce(null);
    const ensureCadPreviewTile = vi.fn().mockResolvedValue({
      storageKey: tileStorageKey,
      mimeType: 'image/png',
      sizeBytes: 4,
      cacheHit: true,
    });
    const service = new DocumentsService(
      { values: { PREVIEW_ARTIFACTS_PATH: directory } } as unknown as AppConfig,
      { document: { findFirst } } as unknown as PrismaService,
      {} as IngestionQueue,
      {} as ChromaVectorStore,
      logger,
      acl,
      { ensureCadPreviewTile } as unknown as ParserClient,
    );

    try {
      await expect(
        service.getDocumentPreviewTile(documentId, 0, 0, 0, identity, bundleId),
      ).rejects.toMatchObject({
        code: 'DOCUMENT_NOT_FOUND',
        status: 404,
      });
      expect(ensureCadPreviewTile).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
