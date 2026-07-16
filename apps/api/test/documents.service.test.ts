import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '../src/auth/identity';
import { DocumentsService } from '../src/documents/documents.service';
import type { AppConfig } from '../src/config/app-config';
import type { PrismaService } from '../src/database/prisma.service';
import type { IngestionQueue } from '../src/ingestion/ingestion.queue';

const identity: Identity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  department: 'finance',
  sensitivity: 'internal',
};

describe('DocumentsService tenant isolation', () => {
  it('always scopes document reads to the authenticated tenant', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new DocumentsService(
      {} as AppConfig,
      { document: { findFirst } } as unknown as PrismaService,
      {} as IngestionQueue,
    );

    await expect(
      service.getDocument('6769af9a-a4d0-4dc2-a97d-942584a9c826', identity),
    ).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_FOUND',
    });
    const [query] = findFirst.mock.calls[0] as unknown as [{ where: { tenantId: string } }];
    expect(query.where.tenantId).toBe('tenant-a');
  });

  it('always scopes ingestion job reads to the authenticated tenant', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new DocumentsService(
      {} as AppConfig,
      { ingestionJob: { findFirst } } as unknown as PrismaService,
      {} as IngestionQueue,
    );

    await expect(
      service.getJob('a5427e4a-b9db-4750-8dfd-02d601a41473', identity),
    ).rejects.toMatchObject({
      code: 'INGESTION_JOB_NOT_FOUND',
    });
    const [query] = findFirst.mock.calls[0] as unknown as [{ where: { tenantId: string } }];
    expect(query.where.tenantId).toBe('tenant-a');
  });
});
