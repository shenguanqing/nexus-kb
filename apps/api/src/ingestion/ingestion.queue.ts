import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ingestionPayloadSchema } from '@nexus-kb/contracts';
import type { IngestionPayload } from '@nexus-kb/contracts';
import { Queue, Worker } from 'bullmq';

import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { ParserClient } from '../parser/parser-client';

@Injectable()
export class IngestionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue<IngestionPayload>;
  private worker?: Worker<IngestionPayload>;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly parser: ParserClient,
  ) {
    this.queue = new Queue<IngestionPayload>('ingestion', {
      connection: { url: config.values.REDIS_URL },
    });
  }

  onModuleInit(): void {
    this.worker = new Worker<IngestionPayload>('ingestion', async (job) => this.process(job.data), {
      connection: { url: this.config.values.REDIS_URL },
      concurrency: this.config.values.INGESTION_CONCURRENCY,
    });
  }

  async enqueue(payload: IngestionPayload): Promise<void> {
    const validated = ingestionPayloadSchema.parse(payload);
    await this.queue.add('parse', validated, {
      jobId: validated.ingestionJobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  private async process(payload: IngestionPayload): Promise<void> {
    payload = ingestionPayloadSchema.parse(payload);
    const record = await this.prisma.ingestionJob.findUnique({
      where: { id: payload.ingestionJobId },
      include: { document: true },
    });
    if (!record || record.status === 'deleted' || record.document.status === 'deleted') return;
    const [jobUpdate] = await this.prisma.$transaction([
      this.prisma.ingestionJob.updateMany({
        where: { id: record.id, status: { not: 'deleted' } },
        data: {
          status: 'parsing',
          step: 'parsing',
          attempts: { increment: 1 },
          startedAt: new Date(),
        },
      }),
      this.prisma.document.updateMany({
        where: { id: record.documentId, status: { not: 'deleted' } },
        data: { status: 'processing' },
      }),
    ]);
    if (jobUpdate.count === 0) return;
    try {
      const result = await this.parser.parse(
        {
          jobId: record.id,
          documentId: record.documentId,
          storagePath: `${this.config.values.RAW_DOCS_PATH}/${payload.storageKey}`,
          mimeType: record.document.mimeType,
        },
        record.traceId,
      );
      await this.prisma.$transaction([
        this.prisma.documentVersion.updateMany({
          where: {
            documentId: record.documentId,
            version: record.version,
            document: { status: { not: 'deleted' } },
          },
          data: {
            parser: result.parser,
            parserVersion: result.parserVersion,
            parsedElements: result.elements as unknown as Prisma.InputJsonValue,
            warnings: result.warnings,
          },
        }),
        this.prisma.ingestionJob.updateMany({
          where: { id: record.id, status: { not: 'deleted' } },
          data: {
            status: 'completed',
            step: 'completed',
            parserVersion: result.parserVersion,
            warnings: result.warnings,
            completedAt: new Date(),
            errorCode: null,
          },
        }),
        this.prisma.document.updateMany({
          where: { id: record.documentId, status: { not: 'deleted' } },
          data: { status: 'active', activeVersion: record.version },
        }),
      ]);
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.ingestionJob.updateMany({
          where: { id: record.id, status: { not: 'deleted' } },
          data: {
            status: 'failed',
            step: 'failed',
            errorCode: 'PARSER_FAILED',
            completedAt: new Date(),
          },
        }),
        this.prisma.document.updateMany({
          where: { id: record.documentId, status: { not: 'deleted' } },
          data: { status: 'failed' },
        }),
      ]);
      throw error;
    }
  }
}
