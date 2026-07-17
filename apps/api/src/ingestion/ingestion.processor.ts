import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ingestionPayloadSchema } from '@nexus-kb/contracts';
import type { IngestionPayload } from '@nexus-kb/contracts';

import { OperationalLogger } from '../common/operational-logger';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { ParserClient } from '../parser/parser-client';
import { EmbeddingProviderFactory } from '../providers/embedding/embedding-provider.factory';
import { EmbeddingService } from '../providers/embedding/embedding.service';
import { ChromaVectorStore } from '../vector-store/chroma-vector-store';
import type { VectorChunk } from '../vector-store/vector-store';
import { VectorStoreError } from '../vector-store/vector-store-error';
import { ChunkingService } from './chunking';
import { CloudPolicyService } from './cloud-policy';
import { classifyIngestionError } from './ingestion-error';
import { RedactionService } from './redaction';

type IngestionRecord = Prisma.IngestionJobGetPayload<{ include: { document: true } }>;

@Injectable()
export class IngestionProcessor {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly parser: ParserClient,
    private readonly chunking: ChunkingService,
    private readonly redaction: RedactionService,
    private readonly cloudPolicy: CloudPolicyService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly embedding: EmbeddingService,
    private readonly vectorStore: ChromaVectorStore,
    private readonly logger: OperationalLogger,
  ) {}

  async process(payload: IngestionPayload): Promise<void> {
    payload = ingestionPayloadSchema.parse(payload);
    const record = await this.prisma.ingestionJob.findUnique({
      where: { id: payload.ingestionJobId },
      include: { document: true },
    });
    if (
      !record ||
      ['completed', 'policy_blocked', 'deleted'].includes(record.status) ||
      ['deleting', 'deleted'].includes(record.document.status)
    ) {
      if (record) {
        this.logger.info('ingestion_duplicate_delivery_skipped', {
          traceId: record.traceId,
          tenantId: record.tenantId,
          jobId: record.id,
          documentId: record.documentId,
          status: record.status,
          checkpoint: record.checkpoint,
        });
      }
      return;
    }
    const resumeFromLocalPreparation = record.checkpoint === 'local_prepared';
    const initialProcessingStatus =
      record.document.mimeType === 'image/vnd.dwg' ? 'converting' : 'parsing';
    const [jobUpdate] = await this.prisma.$transaction([
      this.prisma.ingestionJob.updateMany({
        where: { id: record.id, status: { not: 'deleted' } },
        data: {
          status: resumeFromLocalPreparation ? 'embedding' : initialProcessingStatus,
          step: resumeFromLocalPreparation ? 'embedding' : initialProcessingStatus,
          attempts: { increment: 1 },
          startedAt: record.startedAt ?? new Date(),
          completedAt: null,
          errorCode: null,
          errorCategory: null,
          retryable: false,
        },
      }),
      this.prisma.document.updateMany({
        where: { id: record.documentId, status: { notIn: ['deleting', 'deleted'] } },
        data: { status: 'processing' },
      }),
    ]);
    if (jobUpdate.count === 0) return;
    this.logger.info('ingestion_started', {
      traceId: record.traceId,
      tenantId: record.tenantId,
      jobId: record.id,
      documentId: record.documentId,
      status: resumeFromLocalPreparation ? 'resuming' : 'processing',
      checkpoint: record.checkpoint,
      attempts: record.attempts + 1,
    });
    try {
      const vectorStoreInfo = this.vectorStore.info();
      if (resumeFromLocalPreparation) {
        if (!vectorStoreInfo.enabled) throw new VectorStoreError('not_configured');
        const preparedChunks = await this.loadPreparedChunks(record);
        await this.indexPreparedChunks(record, preparedChunks, vectorStoreInfo);
        return;
      }

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
      const provider = vectorStoreInfo.enabled ? this.embeddingFactory.getProvider() : null;
      const policy = this.cloudPolicy.evaluate({
        sensitivity: record.document.sensitivity,
        providerId: provider?.id,
        region: provider?.region,
      });
      const isBlocked = policy.decision === 'blocked';
      const shouldIndex = !isBlocked && vectorStoreInfo.enabled;
      const persisted = await this.persistLocalPreparation({
        record,
        result,
        redactedChunks,
        policy,
        isBlocked,
        shouldIndex,
        vectorStoreInfo,
      });
      if (!persisted) return;
      if (!shouldIndex) return;

      const preparedChunks: VectorChunk[] = redactedChunks.map((chunk) => ({
        id: chunk.id,
        tenantId: record.tenantId,
        documentId: record.documentId,
        documentVersion: record.version,
        ordinal: chunk.ordinal,
        redactedText: chunk.redaction.text,
        sourceName: record.document.sourceName,
        page: chunk.page,
        sheet: chunk.sheet,
        sectionPath: chunk.sectionPath,
        department: record.document.department,
        sensitivity: record.document.sensitivity,
        ownerId: record.document.ownerId,
        previousChunkId: chunk.previousChunkId,
        nextChunkId: chunk.nextChunkId,
      }));
      await this.indexPreparedChunks(record, preparedChunks, vectorStoreInfo);
    } catch (error) {
      await this.markFailed(record, error);
      throw error;
    }
  }

  private async persistLocalPreparation(input: {
    record: IngestionRecord;
    result: Awaited<ReturnType<ParserClient['parse']>>;
    redactedChunks: Array<
      ReturnType<ChunkingService['createChunks']>[number] & {
        redaction: ReturnType<RedactionService['redact']>;
      }
    >;
    policy: ReturnType<CloudPolicyService['evaluate']>;
    isBlocked: boolean;
    shouldIndex: boolean;
    vectorStoreInfo: ReturnType<ChromaVectorStore['info']>;
  }): Promise<boolean> {
    const { record, result, redactedChunks, policy, isBlocked, shouldIndex, vectorStoreInfo } =
      input;
    const persisted = await this.prisma.$transaction(async (tx) => {
      const lockedDocument = await tx.document.updateMany({
        where: { id: record.documentId, status: { notIn: ['deleting', 'deleted'] } },
        data: { status: 'processing' },
      });
      if (lockedDocument.count === 0) return false;
      await tx.knowledgeChunk.deleteMany({
        where: {
          tenantId: record.tenantId,
          documentId: record.documentId,
          documentVersion: record.version,
        },
      });
      await tx.knowledgeChunk.createMany({
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
      });
      await tx.documentVersion.updateMany({
        where: {
          documentId: record.documentId,
          version: record.version,
          document: { status: { notIn: ['deleting', 'deleted'] } },
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
      });
      await tx.cloudPolicyEvent.upsert({
        where: { ingestionJobId: record.id },
        create: {
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
        update: {
          decision: policy.decision,
          reasonCode: policy.reasonCode,
          sensitivity: record.document.sensitivity,
          providerId: policy.providerId,
          region: policy.region,
          redactionPolicyVersion: this.config.values.REDACTION_POLICY_VERSION,
        },
      });
      await tx.ingestionJob.updateMany({
        where: { id: record.id, status: { not: 'deleted' } },
        data: {
          status: isBlocked ? 'policy_blocked' : shouldIndex ? 'embedding' : 'completed',
          step: isBlocked ? 'policy_blocked' : shouldIndex ? 'embedding' : 'prepared',
          checkpoint: isBlocked ? 'policy_blocked' : shouldIndex ? 'local_prepared' : 'prepared',
          parserVersion: result.parserVersion,
          warnings: result.warnings,
          completedAt: shouldIndex ? null : new Date(),
          errorCode: isBlocked ? policy.reasonCode : null,
          errorCategory: isBlocked ? 'policy' : null,
          retryable: false,
          embeddingFingerprint: vectorStoreInfo.fingerprint,
          vectorCollection: vectorStoreInfo.collectionName,
        },
      });
      await tx.document.updateMany({
        where: { id: record.documentId, status: { notIn: ['deleting', 'deleted'] } },
        data: {
          status: isBlocked ? 'policy_blocked' : shouldIndex ? 'processing' : 'prepared',
          activeVersion: null,
        },
      });
      return true;
    });
    if (!persisted) {
      this.logger.info('ingestion_persistence_skipped_deleted_document', {
        traceId: record.traceId,
        tenantId: record.tenantId,
        jobId: record.id,
        documentId: record.documentId,
        status: 'deleted',
        checkpoint: record.checkpoint,
      });
      return false;
    }
    this.logger.info('ingestion_local_preparation_persisted', {
      traceId: record.traceId,
      tenantId: record.tenantId,
      jobId: record.id,
      documentId: record.documentId,
      provider: policy.providerId ?? undefined,
      status: isBlocked ? 'policy_blocked' : shouldIndex ? 'embedding' : 'prepared',
      checkpoint: isBlocked ? 'policy_blocked' : shouldIndex ? 'local_prepared' : 'prepared',
    });
    return true;
  }

  private async loadPreparedChunks(record: IngestionRecord): Promise<VectorChunk[]> {
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        tenantId: record.tenantId,
        documentId: record.documentId,
        documentVersion: record.version,
      },
      orderBy: { ordinal: 'asc' },
    });
    if (chunks.length === 0) throw new VectorStoreError('invalid_input');
    return chunks.map((chunk) => ({
      id: chunk.id,
      tenantId: record.tenantId,
      documentId: record.documentId,
      documentVersion: record.version,
      ordinal: chunk.ordinal,
      redactedText: chunk.redactedText,
      sourceName: record.document.sourceName,
      page: chunk.page,
      sheet: chunk.sheet,
      sectionPath: this.stringArray(chunk.sectionPath),
      department: record.document.department,
      sensitivity: record.document.sensitivity,
      ownerId: record.document.ownerId,
      previousChunkId: chunk.previousChunkId,
      nextChunkId: chunk.nextChunkId,
    }));
  }

  private async indexPreparedChunks(
    record: IngestionRecord,
    chunks: VectorChunk[],
    vectorStoreInfo: ReturnType<ChromaVectorStore['info']>,
  ): Promise<void> {
    const provider = this.embeddingFactory.getProvider();
    const vectors = await this.embedding.embedDocuments(
      chunks.map((chunk) => chunk.redactedText),
      { sensitivity: record.document.sensitivity },
    );
    await this.prisma.ingestionJob.updateMany({
      where: { id: record.id, status: { not: 'deleted' } },
      data: { status: 'indexing', step: 'indexing' },
    });
    await this.vectorStore.upsert(chunks, vectors);
    const activated = await this.activateVersion(
      record.id,
      record.documentId,
      record.version,
      vectorStoreInfo.fingerprint,
      vectorStoreInfo.collectionName,
    );
    if (!activated) {
      await this.vectorStore.deleteDocument(record.tenantId, record.documentId);
      this.logger.info('ingestion_activation_skipped_deleted_document', {
        traceId: record.traceId,
        tenantId: record.tenantId,
        jobId: record.id,
        documentId: record.documentId,
        provider: provider.id,
        model: provider.model,
        status: 'deleted',
        checkpoint: record.checkpoint,
      });
      return;
    }
    this.logger.info('ingestion_completed', {
      traceId: record.traceId,
      tenantId: record.tenantId,
      jobId: record.id,
      documentId: record.documentId,
      provider: provider.id,
      model: provider.model,
      status: 'completed',
      checkpoint: 'completed',
    });
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }

  private async activateVersion(
    jobId: string,
    documentId: string,
    version: number,
    fingerprint: string | null,
    collectionName: string | null,
  ): Promise<boolean> {
    if (!fingerprint || !collectionName) throw new VectorStoreError('configuration_mismatch');
    const [, , documentUpdate] = await this.prisma.$transaction([
      this.prisma.documentVersion.updateMany({
        where: {
          documentId,
          version,
          document: { status: { notIn: ['deleting', 'deleted'] } },
        },
        data: {
          embeddingFingerprint: fingerprint,
          vectorCollection: collectionName,
          indexedAt: new Date(),
        },
      }),
      this.prisma.ingestionJob.updateMany({
        where: { id: jobId, status: { not: 'deleted' } },
        data: {
          status: 'completed',
          step: 'completed',
          checkpoint: 'completed',
          completedAt: new Date(),
          errorCode: null,
          errorCategory: null,
          retryable: false,
        },
      }),
      this.prisma.document.updateMany({
        where: { id: documentId, status: { notIn: ['deleting', 'deleted'] } },
        data: { status: 'active', activeVersion: version },
      }),
    ]);
    return documentUpdate.count > 0;
  }

  private async markFailed(record: IngestionRecord, error: unknown): Promise<void> {
    const classified = classifyIngestionError(error);
    await this.prisma.$transaction([
      this.prisma.ingestionJob.updateMany({
        where: { id: record.id, status: { not: 'deleted' } },
        data: {
          status: 'failed',
          step: 'failed',
          errorCode: classified.code,
          errorCategory: classified.category,
          retryable: classified.retryable,
          completedAt: new Date(),
        },
      }),
      this.prisma.document.updateMany({
        where: { id: record.documentId, status: { notIn: ['deleting', 'deleted'] } },
        data: { status: 'failed' },
      }),
    ]);
    const logContext = {
      traceId: record.traceId,
      tenantId: record.tenantId,
      jobId: record.id,
      documentId: record.documentId,
      status: 'failed',
      errorCode: classified.code,
      errorCategory: classified.category,
      checkpoint: record.checkpoint,
      attempts: record.attempts + 1,
    };
    if (classified.retryable) {
      this.logger.warn('ingestion_attempt_failed_retryable', logContext);
    } else {
      this.logger.error('ingestion_failed_terminal', logContext);
    }
  }
}
