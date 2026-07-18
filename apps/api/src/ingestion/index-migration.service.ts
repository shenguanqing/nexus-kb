import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { ApiException } from '../common/api-exception';
import { OperationalLogger } from '../common/operational-logger';
import { PrismaService } from '../database/prisma.service';
import { ChromaVectorStore } from '../vector-store/chroma-vector-store';
import { IngestionProcessor } from './ingestion.processor';

const RUNNING_STATUSES = [
  'queued',
  'converting',
  'parsing',
  'chunking',
  'policy_check',
  'embedding',
  'indexing',
] as const;

@Injectable()
export class IndexMigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: IngestionProcessor,
    private readonly vectorStore: ChromaVectorStore,
    private readonly logger: OperationalLogger,
  ) {}

  async prepare(): Promise<{
    prepared: number;
    reused: number;
    fingerprint: string;
    collectionName: string;
  }> {
    await this.vectorStore.healthCheck();
    const target = this.requiredTarget();
    const documents = await this.prisma.document.findMany({
      where: { status: 'active', activeVersion: { not: null } },
      orderBy: [{ tenantId: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        storageKey: true,
        activeVersion: true,
        versions: {
          orderBy: { version: 'desc' },
          select: {
            version: true,
            status: true,
            embeddingFingerprint: true,
            vectorCollection: true,
          },
        },
      },
    });
    let prepared = 0;
    let reused = 0;
    for (const document of documents) {
      const existing = document.versions.find(
        (version) =>
          (version.status === 'prepared' || version.version === document.activeVersion) &&
          version.embeddingFingerprint === target.fingerprint &&
          version.vectorCollection === target.collectionName,
      );
      if (existing) {
        reused += 1;
        continue;
      }
      const runningJob = await this.prisma.ingestionJob.findFirst({
        where: { documentId: document.id, status: { in: [...RUNNING_STATUSES] } },
        select: { id: true },
      });
      if (runningJob) {
        throw new ApiException(
          'INDEX_MIGRATION_DOCUMENT_BUSY',
          '存在正在处理的文档，索引迁移准备已停止',
          409,
        );
      }
      const version = (document.versions[0]?.version ?? document.activeVersion ?? 0) + 1;
      const jobId = randomUUID();
      const traceId = randomUUID();
      await this.prisma.$transaction([
        this.prisma.documentVersion.create({
          data: {
            id: randomUUID(),
            tenantId: document.tenantId,
            documentId: document.id,
            version,
            status: 'processing',
          },
        }),
        this.prisma.ingestionJob.create({
          data: {
            id: jobId,
            tenantId: document.tenantId,
            documentId: document.id,
            version,
            kind: 'index_migration',
            activateOnComplete: false,
            traceId,
          },
        }),
        this.prisma.documentLifecycleAudit.create({
          data: {
            id: randomUUID(),
            tenantId: document.tenantId,
            traceId,
            documentId: document.id,
            documentVersion: version,
            ingestionJobId: jobId,
            eventType: 'index_candidate_requested',
            outcome: 'processing',
            vectorCollection: target.collectionName,
            embeddingFingerprint: target.fingerprint,
          },
        }),
      ]);
      await this.processor.process({
        ingestionJobId: jobId,
        documentId: document.id,
        storageKey: document.storageKey,
      });
      const candidate = await this.prisma.documentVersion.findUnique({
        where: { documentId_version: { documentId: document.id, version } },
        select: { status: true, embeddingFingerprint: true, vectorCollection: true },
      });
      if (
        candidate?.status !== 'prepared' ||
        candidate.embeddingFingerprint !== target.fingerprint ||
        candidate.vectorCollection !== target.collectionName
      ) {
        throw new ApiException(
          'INDEX_MIGRATION_CANDIDATE_INVALID',
          '候选索引未通过完整性校验，旧索引保持生效',
          409,
        );
      }
      prepared += 1;
    }
    this.logger.info('index_migration_candidates_prepared', {
      status: 'completed',
      provider: 'configured_embedding_provider',
      documentCount: prepared,
      reusedCount: reused,
    });
    return { prepared, reused, ...target };
  }

  async activate(): Promise<{
    switched: number;
    unchanged: number;
    fingerprint: string;
    collectionName: string;
  }> {
    await this.vectorStore.healthCheck();
    const target = this.requiredTarget();
    const documents = await this.prisma.document.findMany({
      where: { status: 'active', activeVersion: { not: null } },
      orderBy: [{ tenantId: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        activeVersion: true,
        versions: {
          orderBy: { version: 'desc' },
          select: {
            version: true,
            status: true,
            embeddingFingerprint: true,
            vectorCollection: true,
          },
        },
      },
    });
    const switches: Array<{
      id: string;
      tenantId: string;
      fromVersion: number;
      toVersion: number;
    }> = [];
    let unchanged = 0;
    for (const document of documents) {
      const active = document.versions.find(
        (version) => version.version === document.activeVersion,
      );
      if (
        active?.embeddingFingerprint === target.fingerprint &&
        active.vectorCollection === target.collectionName
      ) {
        unchanged += 1;
        continue;
      }
      const candidate = document.versions.find(
        (version) =>
          ['prepared', 'superseded'].includes(version.status) &&
          version.embeddingFingerprint === target.fingerprint &&
          version.vectorCollection === target.collectionName,
      );
      if (!candidate || document.activeVersion === null) {
        throw new ApiException(
          'INDEX_MIGRATION_INCOMPLETE',
          '并非所有已生效文档都已完成候选索引，禁止切换',
          409,
        );
      }
      switches.push({
        id: document.id,
        tenantId: document.tenantId,
        fromVersion: document.activeVersion,
        toVersion: candidate.version,
      });
    }
    const traceId = randomUUID();
    const switchedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const item of switches) {
        const documentUpdate = await tx.document.updateMany({
          where: { id: item.id, status: 'active', activeVersion: item.fromVersion },
          data: { activeVersion: item.toVersion },
        });
        if (documentUpdate.count !== 1) {
          throw new ApiException(
            'INDEX_MIGRATION_CONFLICT',
            '索引切换期间文档版本发生变化，操作已回滚',
            409,
          );
        }
        await tx.documentVersion.updateMany({
          where: { documentId: item.id, version: item.fromVersion },
          data: { status: 'superseded', supersededAt: switchedAt },
        });
        await tx.documentVersion.updateMany({
          where: { documentId: item.id, version: item.toVersion },
          data: { status: 'active', activatedAt: switchedAt, supersededAt: null },
        });
        await tx.documentLifecycleAudit.create({
          data: {
            id: randomUUID(),
            tenantId: item.tenantId,
            traceId,
            documentId: item.id,
            documentVersion: item.toVersion,
            eventType: 'index_collection_switched',
            outcome: 'completed',
            vectorCollection: target.collectionName,
            embeddingFingerprint: target.fingerprint,
          },
        });
      }
    });
    this.logger.info('index_migration_collection_switched', {
      traceId,
      status: 'completed',
      documentCount: switches.length,
      reusedCount: unchanged,
    });
    return { switched: switches.length, unchanged, ...target };
  }

  private requiredTarget(): { fingerprint: string; collectionName: string } {
    const target = this.vectorStore.info();
    if (!target.enabled || !target.fingerprint || !target.collectionName) {
      throw new ApiException(
        'INDEX_MIGRATION_NOT_CONFIGURED',
        '必须配置 Embedding Provider 才能执行索引迁移',
        503,
      );
    }
    return { fingerprint: target.fingerprint, collectionName: target.collectionName };
  }
}
