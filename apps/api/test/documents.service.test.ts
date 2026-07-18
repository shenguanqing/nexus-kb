import { mkdtemp, readdir, rm } from 'node:fs/promises';
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
import type { ChromaVectorStore } from '../src/vector-store/chroma-vector-store';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  roles: [],
  allowedSensitivities: ['public', 'internal'],
  capabilities: ['documents:read', 'documents:write', 'documents:delete'],
  defaultSensitivity: 'internal',
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as OperationalLogger;
const acl = new AclPolicy();

describe('DocumentsService tenant isolation', () => {
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
});
