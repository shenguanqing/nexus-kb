import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ingestionPayloadSchema } from '@nexus-kb/contracts';
import type { IngestionPayload } from '@nexus-kb/contracts';

import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { ParserClient } from '../parser/parser-client';
import { EmbeddingProviderFactory } from '../providers/embedding/embedding-provider.factory';
import { EmbeddingService } from '../providers/embedding/embedding.service';
import { ProviderError } from '../providers/embedding/provider-error';
import { ChromaVectorStore } from '../vector-store/chroma-vector-store';
import type { VectorChunk } from '../vector-store/vector-store';
import { VectorStoreError } from '../vector-store/vector-store-error';
import { ChunkingService } from './chunking';
import { CloudPolicyService } from './cloud-policy';
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
  ) {}

  async process(payload: IngestionPayload): Promise<void> {
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
      const vectorStoreInfo = this.vectorStore.info();
      const provider = vectorStoreInfo.enabled ? this.embeddingFactory.getProvider() : null;
      const policy = this.cloudPolicy.evaluate({
        sensitivity: record.document.sensitivity,
        providerId: provider?.id,
        region: provider?.region,
      });
      const isBlocked = policy.decision === 'blocked';
      const shouldIndex = !isBlocked && vectorStoreInfo.enabled;
      await this.persistLocalPreparation({
        record,
        result,
        redactedChunks,
        policy,
        isBlocked,
        shouldIndex,
        vectorStoreInfo,
      });
      if (!shouldIndex) return;

      const vectors = await this.embedding.embedDocuments(
        redactedChunks.map((chunk) => chunk.redaction.text),
        { sensitivity: record.document.sensitivity },
      );
      await this.prisma.ingestionJob.updateMany({
        where: { id: record.id, status: { not: 'deleted' } },
        data: { status: 'indexing', step: 'indexing' },
      });
      const vectorChunks: VectorChunk[] = redactedChunks.map((chunk) => ({
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
      await this.vectorStore.upsert(vectorChunks, vectors);
      await this.activateVersion(
        record.id,
        record.documentId,
        record.version,
        vectorStoreInfo.fingerprint,
        vectorStoreInfo.collectionName,
      );
    } catch (error) {
      await this.markFailed(record.id, record.documentId, error);
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
  }): Promise<void> {
    const { record, result, redactedChunks, policy, isBlocked, shouldIndex, vectorStoreInfo } =
      input;
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
          status: isBlocked ? 'policy_blocked' : shouldIndex ? 'embedding' : 'completed',
          step: isBlocked ? 'policy_blocked' : shouldIndex ? 'embedding' : 'prepared',
          parserVersion: result.parserVersion,
          warnings: result.warnings,
          completedAt: shouldIndex ? null : new Date(),
          errorCode: isBlocked ? policy.reasonCode : null,
          embeddingFingerprint: vectorStoreInfo.fingerprint,
          vectorCollection: vectorStoreInfo.collectionName,
        },
      }),
      this.prisma.document.updateMany({
        where: { id: record.documentId, status: { not: 'deleted' } },
        data: {
          status: isBlocked ? 'policy_blocked' : shouldIndex ? 'processing' : 'prepared',
          activeVersion: null,
        },
      }),
    ]);
  }

  private async activateVersion(
    jobId: string,
    documentId: string,
    version: number,
    fingerprint: string | null,
    collectionName: string | null,
  ): Promise<void> {
    if (!fingerprint || !collectionName) throw new VectorStoreError('configuration_mismatch');
    await this.prisma.$transaction([
      this.prisma.documentVersion.updateMany({
        where: {
          documentId,
          version,
          document: { status: { not: 'deleted' } },
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
          completedAt: new Date(),
          errorCode: null,
        },
      }),
      this.prisma.document.updateMany({
        where: { id: documentId, status: { not: 'deleted' } },
        data: { status: 'active', activeVersion: version },
      }),
    ]);
  }

  private async markFailed(jobId: string, documentId: string, error: unknown): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.ingestionJob.updateMany({
        where: { id: jobId, status: { not: 'deleted' } },
        data: {
          status: 'failed',
          step: 'failed',
          errorCode: this.errorCode(error),
          completedAt: new Date(),
        },
      }),
      this.prisma.document.updateMany({
        where: { id: documentId, status: { not: 'deleted' } },
        data: { status: 'failed' },
      }),
    ]);
  }

  private errorCode(error: unknown): string {
    if (error instanceof ProviderError || error instanceof VectorStoreError) return error.code;
    return 'INGESTION_FAILED';
  }
}
