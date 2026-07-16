import { randomUUID } from 'node:crypto';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ingestionPayloadSchema } from '@nexus-kb/contracts';
import type { IngestionPayload } from '@nexus-kb/contracts';
import { Queue, Worker } from 'bullmq';

import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { ParserClient } from '../parser/parser-client';
import { ChunkingService } from './chunking';
import { CloudPolicyService } from './cloud-policy';
import { RedactionService } from './redaction';

@Injectable()
export class IngestionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue<IngestionPayload>;
  private worker?: Worker<IngestionPayload>;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly parser: ParserClient,
    private readonly chunking: ChunkingService,
    private readonly redaction: RedactionService,
    private readonly cloudPolicy: CloudPolicyService,
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
      await this.prisma.ingestionJob.updateMany({
        where: { id: record.id, status: { not: 'deleted' } },
        data: { status: 'chunking', step: 'chunking' },
      });
      const chunks = this.chunking.createChunks(record.documentId, record.version, result.elements);
      if (chunks.length === 0) throw new Error('Chunking produced no chunks');
      const redactedChunks = chunks.map((chunk) => ({
        ...chunk,
        redaction: this.redaction.redact(chunk.originalText),
      }));
      await this.prisma.ingestionJob.updateMany({
        where: { id: record.id, status: { not: 'deleted' } },
        data: { status: 'policy_check', step: 'policy_check' },
      });
      const policy = this.cloudPolicy.evaluate({
        sensitivity: record.document.sensitivity,
      });
      const isBlocked = policy.decision === 'blocked';
      await this.prisma.$transaction([
        this.prisma.knowledgeChunk.deleteMany({
          where: {
            tenantId: record.tenantId,
            documentId: record.documentId,
            documentVersion: record.version,
          },
        }),
        this.prisma.knowledgeChunk.createMany({
          data: redactedChunks.map((chunk) => ({
            id: chunk.id,
            tenantId: record.tenantId,
            documentId: record.documentId,
            documentVersion: record.version,
            ordinal: chunk.ordinal,
            originalText: chunk.originalText,
            redactedText: chunk.redaction.text,
            tokenCount: chunk.tokenCount,
            page: chunk.page,
            sheet: chunk.sheet,
            sectionPath: chunk.sectionPath,
            elementTypes: chunk.elementTypes,
            previousChunkId: chunk.previousChunkId,
            nextChunkId: chunk.nextChunkId,
            redactionPolicyVersion: chunk.redaction.policyVersion,
            redactionSummary: chunk.redaction.summary,
          })),
        }),
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
            chunkCount: redactedChunks.length,
            redactionPolicyVersion: this.config.values.REDACTION_POLICY_VERSION,
            cloudPolicyDecision: policy.decision,
          },
        }),
        this.prisma.cloudPolicyEvent.create({
          data: {
            id: randomUUID(),
            tenantId: record.tenantId,
            documentId: record.documentId,
            documentVersion: record.version,
            ingestionJobId: record.id,
            decision: policy.decision,
            reasonCode: policy.reasonCode,
            sensitivity: record.document.sensitivity,
            providerId: policy.providerId,
            region: policy.region,
            redactionPolicyVersion: this.config.values.REDACTION_POLICY_VERSION,
          },
        }),
        this.prisma.ingestionJob.updateMany({
          where: { id: record.id, status: { not: 'deleted' } },
          data: {
            status: isBlocked ? 'policy_blocked' : 'completed',
            step: isBlocked ? 'policy_blocked' : 'completed',
            parserVersion: result.parserVersion,
            warnings: result.warnings,
            completedAt: new Date(),
            errorCode: isBlocked ? policy.reasonCode : null,
          },
        }),
        this.prisma.document.updateMany({
          where: { id: record.documentId, status: { not: 'deleted' } },
          data: {
            status: isBlocked ? 'policy_blocked' : 'prepared',
            activeVersion: null,
          },
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
