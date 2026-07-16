import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ingestionPayloadSchema } from '@nexus-kb/contracts';

describe('PostgreSQL and Redis integration', () => {
  const prisma = new PrismaClient();
  const queueName = `ingestion-test-${randomUUID()}`;
  const queue = new Queue(queueName, { connection: { url: process.env.REDIS_URL } });
  const tenantA = `tenant-a-${randomUUID()}`;
  const tenantB = `tenant-b-${randomUUID()}`;
  const documentId = randomUUID();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { id: documentId } });
    await queue.obliterate({ force: true });
    await queue.close();
    await prisma.$disconnect();
  });

  it('enforces tenant criteria before returning a document', async () => {
    await prisma.document.create({
      data: {
        id: documentId,
        tenantId: tenantA,
        sourceName: 'fixture.txt',
        storageKey: `${documentId}.txt`,
        mimeType: 'text/plain',
        contentSha256: '0'.repeat(64),
        department: 'finance',
        sensitivity: 'internal',
        ownerId: 'integration-user',
      },
    });

    await expect(
      prisma.document.findFirst({ where: { id: documentId, tenantId: tenantB } }),
    ).resolves.toBeNull();
    await expect(
      prisma.document.findFirst({ where: { id: documentId, tenantId: tenantA } }),
    ).resolves.toMatchObject({ id: documentId });
  });

  it('stores only validated IDs and a file reference in Redis', async () => {
    const payload = ingestionPayloadSchema.parse({
      ingestionJobId: randomUUID(),
      documentId,
      storageKey: `${documentId}.txt`,
    });
    const job = await queue.add('parse', payload, { jobId: payload.ingestionJobId });
    const stored = await queue.getJob(job.id ?? '');

    expect(stored?.data).toEqual(payload);
    expect(JSON.stringify(stored?.data)).not.toContain('content');
    expect(JSON.stringify(stored?.data)).not.toContain('tenantId');
  });
});
