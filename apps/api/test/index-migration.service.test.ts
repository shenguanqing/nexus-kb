import { describe, expect, it, vi } from 'vitest';

import type { OperationalLogger } from '../src/common/operational-logger';
import type { PrismaService } from '../src/database/prisma.service';
import { IndexMigrationService } from '../src/ingestion/index-migration.service';
import type { IngestionProcessor } from '../src/ingestion/ingestion.processor';
import type { ChromaVectorStore } from '../src/vector-store/chroma-vector-store';

const fingerprint = 'a'.repeat(64);
const collectionName = 'nexuskb_alibaba_candidate';
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as OperationalLogger;
const vectorStore = {
  info: () => ({ enabled: true, fingerprint, collectionName }),
  healthCheck: () => Promise.resolve(),
} as ChromaVectorStore;

describe('IndexMigrationService', () => {
  it('prepares candidate versions without changing the active version', async () => {
    const createVersion = vi.fn().mockResolvedValue({});
    const createJob = vi.fn().mockResolvedValue({});
    const createAudit = vi.fn().mockResolvedValue({});
    const process = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            tenantId: 'tenant-a',
            storageKey: '6769af9a-a4d0-4dc2-a97d-942584a9c826.md',
            activeVersion: 1,
            versions: [
              {
                version: 1,
                status: 'active',
                embeddingFingerprint: 'b'.repeat(64),
                vectorCollection: 'nexuskb_alibaba_old',
              },
            ],
          },
        ]),
      },
      ingestionJob: { findFirst: vi.fn().mockResolvedValue(null), create: createJob },
      documentVersion: {
        create: createVersion,
        findUnique: vi.fn().mockResolvedValue({
          status: 'prepared',
          embeddingFingerprint: fingerprint,
          vectorCollection: collectionName,
        }),
      },
      documentLifecycleAudit: { create: createAudit },
      $transaction: (operations: Array<Promise<unknown>>) => Promise.all(operations),
    } as unknown as PrismaService;
    const service = new IndexMigrationService(
      prisma,
      { process } as unknown as IngestionProcessor,
      vectorStore,
      logger,
    );

    await expect(service.prepare()).resolves.toMatchObject({ prepared: 1, reused: 0 });
    expect(createVersion).toHaveBeenCalledOnce();
    expect(createJob).toHaveBeenCalledOnce();
    expect(createAudit).toHaveBeenCalledOnce();
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
      }),
    );
  });

  it('atomically activates only fully prepared candidate versions', async () => {
    const updateDocument = vi.fn().mockResolvedValue({ count: 1 });
    const updateVersion = vi.fn().mockResolvedValue({ count: 1 });
    const createAudit = vi.fn().mockResolvedValue({});
    const transactionClient = {
      document: { updateMany: updateDocument },
      documentVersion: { updateMany: updateVersion },
      documentLifecycleAudit: { create: createAudit },
    };
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            tenantId: 'tenant-a',
            activeVersion: 1,
            versions: [
              {
                version: 2,
                status: 'prepared',
                embeddingFingerprint: fingerprint,
                vectorCollection: collectionName,
              },
              {
                version: 1,
                status: 'active',
                embeddingFingerprint: 'b'.repeat(64),
                vectorCollection: 'nexuskb_alibaba_old',
              },
            ],
          },
        ]),
      },
      $transaction: (operation: (tx: typeof transactionClient) => Promise<unknown>) =>
        operation(transactionClient),
    } as unknown as PrismaService;
    const service = new IndexMigrationService(
      prisma,
      {} as IngestionProcessor,
      vectorStore,
      logger,
    );

    await expect(service.activate()).resolves.toMatchObject({ switched: 1, unchanged: 0 });
    const [documentInput] = updateDocument.mock.calls[0] as unknown as [
      { where: { activeVersion: number }; data: { activeVersion: number } },
    ];
    expect(documentInput.where.activeVersion).toBe(1);
    expect(documentInput.data).toEqual({ activeVersion: 2 });
    expect(updateVersion).toHaveBeenCalledTimes(2);
    expect(createAudit).toHaveBeenCalledOnce();
  });

  it('refuses activation before every active document has a candidate', async () => {
    const transaction = vi.fn();
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: '6769af9a-a4d0-4dc2-a97d-942584a9c826',
            tenantId: 'tenant-a',
            activeVersion: 1,
            versions: [
              {
                version: 1,
                status: 'active',
                embeddingFingerprint: 'b'.repeat(64),
                vectorCollection: 'nexuskb_alibaba_old',
              },
            ],
          },
        ]),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new IndexMigrationService(
      prisma,
      {} as IngestionProcessor,
      vectorStore,
      logger,
    );

    await expect(service.activate()).rejects.toMatchObject({
      code: 'INDEX_MIGRATION_INCOMPLETE',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
