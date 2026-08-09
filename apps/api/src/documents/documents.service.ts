import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable, Optional } from '@nestjs/common';
import { cadPreviewManifestSchema } from '@nexus-kb/contracts';
import type {
  CadPreviewManifest,
  DocumentDetail,
  DocumentChunkListRequest,
  DocumentChunkListResponse,
  DocumentListRequest,
  DocumentListResponse,
  DocumentMetadataUpdateRequest,
  DocumentPreview,
  DocumentUploadOptions,
  IngestionJob,
  IngestionJobListRequest,
  IngestionJobListResponse,
  IngestionRetryAccepted,
} from '@nexus-kb/contracts';
import type { MultipartFile } from '@fastify/multipart';
import { Prisma } from '@prisma/client';

import { AclPolicy } from '../auth/acl-policy';
import { isAdmin } from '../auth/app-role';
import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { OperationalLogger } from '../common/operational-logger';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { IngestionQueue } from '../ingestion/ingestion.queue';
import { ParserClient } from '../parser/parser-client';
import { ParserError } from '../parser/parser-error';
import { ChromaVectorStore } from '../vector-store/chroma-vector-store';
import { validateUploadedFile } from './file-validation';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queue: IngestionQueue,
    private readonly vectorStore: ChromaVectorStore,
    private readonly logger: OperationalLogger,
    private readonly acl: AclPolicy,
    @Optional() private readonly parserClient?: ParserClient,
  ) {}

  async listDocuments(
    request: DocumentListRequest,
    identity: Identity,
  ): Promise<DocumentListResponse> {
    this.acl.assertCapability(identity, 'documents:read');
    const where: Prisma.DocumentWhereInput = {
      ...this.acl.documentWhere(identity),
      status: request.status ?? { notIn: ['deleting', 'deleted'] },
      ...(request.department ? { department: request.department } : {}),
      ...(request.sensitivity ? { sensitivity: request.sensitivity } : {}),
      AND: [
        ...(request.search
          ? [{ sourceName: { contains: request.search, mode: 'insensitive' as const } }]
          : []),
        ...(request.format
          ? [{ sourceName: { endsWith: `.${request.format}`, mode: 'insensitive' as const } }]
          : []),
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (request.page - 1) * request.pageSize,
        take: request.pageSize,
        select: {
          id: true,
          sourceName: true,
          mimeType: true,
          department: true,
          sensitivity: true,
          ownerId: true,
          activeVersion: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          jobs: {
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              id: true,
              status: true,
              step: true,
              attempts: true,
              retryable: true,
              errorCode: true,
              updatedAt: true,
            },
          },
        },
      }),
      this.prisma.document.count({ where }),
    ]);
    return {
      items: rows.map(({ jobs, createdAt, updatedAt, ...document }) => {
        const latestJob = jobs[0];
        return {
          ...document,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
          latestJob: latestJob
            ? { ...latestJob, updatedAt: latestJob.updatedAt.toISOString() }
            : null,
        };
      }),
      page: request.page,
      pageSize: request.pageSize,
      total,
    };
  }

  getUploadOptions(identity: Identity): DocumentUploadOptions {
    this.acl.assertCapability(identity, 'documents:write');
    return {
      maxUploadBytes: this.config.values.MAX_UPLOAD_BYTES,
      acceptedExtensions: [
        'txt',
        'md',
        'docx',
        'xlsx',
        'pdf',
        'png',
        'jpg',
        'jpeg',
        'dxf',
        ...(this.config.values.DWG_CONVERSION_ENABLED ? (['dwg'] as const) : []),
      ],
      department: identity.department,
      allowedSensitivities: identity.allowedSensitivities,
      defaultSensitivity: identity.defaultSensitivity,
      dwgConversionEnabled: this.config.values.DWG_CONVERSION_ENABLED,
    };
  }

  async upload(file: MultipartFile, identity: Identity, traceId: string): Promise<object> {
    this.acl.assertCapability(identity, 'documents:write');
    const sourceName = file.filename.normalize('NFC');
    if (!sourceName || sourceName !== basename(sourceName) || sourceName.includes('\0')) {
      throw new ApiException('INVALID_FILENAME', '文件名不合法', 400);
    }
    const documentId = randomUUID();
    const jobId = randomUUID();
    const temporaryKey = `.upload-${documentId}`;
    const temporaryPath = join(this.config.values.RAW_DOCS_PATH, temporaryKey);
    let finalPath: string | undefined;
    let documentCreated = false;
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        bytes += chunk.length;
        if (bytes > this.config.values.MAX_UPLOAD_BYTES) {
          callback(new ApiException('FILE_TOO_LARGE', '文件超过大小限制', 413));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        file.file,
        meter,
        createWriteStream(temporaryPath, { flags: 'wx', mode: 0o644 }),
      );
      if (bytes === 0) throw new ApiException('EMPTY_FILE', '不接受空文件', 400);
      if (file.file.truncated) throw new ApiException('FILE_TOO_LARGE', '文件超过大小限制', 413);
      const validated = await validateUploadedFile(
        temporaryPath,
        sourceName,
        file.mimetype,
        this.config.values.DWG_CONVERSION_ENABLED,
      );
      const contentSha256 = hash.digest('hex');
      const deduplicationKey = createHash('sha256')
        .update(
          [
            identity.tenantId,
            contentSha256,
            identity.department,
            identity.defaultSensitivity,
            identity.userId,
          ].join('\0'),
        )
        .digest('hex');
      const duplicate = await this.prisma.document.findFirst({
        where: {
          tenantId: identity.tenantId,
          contentSha256,
          department: identity.department,
          sensitivity: identity.defaultSensitivity,
          ownerId: identity.userId,
          status: { not: 'deleted' },
        },
        select: { id: true },
      });
      if (duplicate) throw this.duplicateError();
      const storageKey = `${documentId}${validated.extension}`;
      finalPath = join(this.config.values.RAW_DOCS_PATH, storageKey);
      await rename(temporaryPath, finalPath);

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.document.create({
            data: {
              id: documentId,
              tenantId: identity.tenantId,
              sourceName,
              storageKey,
              mimeType: validated.mimeType,
              contentSha256,
              deduplicationKey,
              department: identity.department,
              sensitivity: identity.defaultSensitivity,
              ownerId: identity.userId,
              versions: {
                create: { id: randomUUID(), tenantId: identity.tenantId, version: 1 },
              },
              jobs: {
                create: {
                  id: jobId,
                  tenantId: identity.tenantId,
                  version: 1,
                  traceId,
                },
              },
            },
          });
        });
        documentCreated = true;
      } catch (error) {
        if (this.isUniqueConflict(error)) throw this.duplicateError();
        throw error;
      }
      try {
        await this.queue.enqueue({ ingestionJobId: jobId, documentId, storageKey });
      } catch (error) {
        await this.prisma.ingestionJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            step: 'failed',
            errorCode: 'QUEUE_UNAVAILABLE',
            errorCategory: 'queue',
            retryable: true,
            completedAt: new Date(),
          },
        });
        throw error;
      }
      this.logger.info('document_upload_queued', {
        traceId,
        tenantId: identity.tenantId,
        userId: identity.userId,
        jobId,
        documentId,
        status: 'queued',
      });
      return { documentId, jobId, status: 'queued', traceId };
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      if (finalPath && !documentCreated) await unlink(finalPath).catch(() => undefined);
      throw error;
    }
  }

  async getDocument(id: string, identity: Identity): Promise<DocumentDetail> {
    this.acl.assertCapability(identity, 'documents:read');
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        ...this.acl.documentWhere(identity),
        status: { notIn: ['deleting', 'deleted'] },
      },
      select: {
        id: true,
        sourceName: true,
        mimeType: true,
        department: true,
        sensitivity: true,
        ownerId: true,
        activeVersion: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        versions: {
          orderBy: { version: 'desc' },
          select: {
            version: true,
            status: true,
            parser: true,
            parserVersion: true,
            warnings: true,
            chunkCount: true,
            vectorCollection: true,
            embeddingFingerprint: true,
            indexedAt: true,
            activatedAt: true,
            supersededAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!document) throw new ApiException('DOCUMENT_NOT_FOUND', '文档不存在', 404);
    return {
      ...document,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      versions: document.versions.map((version) => ({
        ...version,
        warnings: this.stringArray(version.warnings),
        indexedAt: version.indexedAt?.toISOString() ?? null,
        activatedAt: version.activatedAt?.toISOString() ?? null,
        supersededAt: version.supersededAt?.toISOString() ?? null,
        createdAt: version.createdAt.toISOString(),
      })),
    };
  }

  async getDocumentPreview(id: string, identity: Identity): Promise<DocumentPreview> {
    this.acl.assertCapability(identity, 'documents:read');
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        ...this.acl.documentWhere(identity),
        status: { notIn: ['deleting', 'deleted'] },
      },
      select: {
        id: true,
        sourceName: true,
        mimeType: true,
        activeVersion: true,
        previewStorageKey: true,
        previewKind: true,
        previewMimeType: true,
        previewRenderer: true,
        previewRendererVersion: true,
        previewGeneratedAt: true,
        versions: {
          orderBy: { version: 'desc' },
          select: { version: true, chunkCount: true },
        },
      },
    });
    if (!document) throw new ApiException('DOCUMENT_NOT_FOUND', '文档不存在', 404);

    const direct = this.directPreview(document.mimeType, document.sourceName);
    if (direct) {
      return {
        documentId: document.id,
        sourceName: document.sourceName,
        sourceMimeType: document.mimeType,
        status: 'ready',
        ...direct,
        renderer: 'browser-native',
        rendererVersion: null,
        generatedAt: null,
        fallbackVersion: null,
        cad: null,
      };
    }
    if (
      document.previewStorageKey &&
      this.isGeneratedPreview(document.previewKind, document.previewMimeType) &&
      this.previewStorageKeyMatches(document.id, document.previewStorageKey, document.previewKind)
    ) {
      const cad =
        document.previewKind === 'cad_tiles'
          ? await this.readCadPreviewManifest(document.id, document.previewStorageKey)
          : null;
      return {
        documentId: document.id,
        sourceName: document.sourceName,
        sourceMimeType: document.mimeType,
        status: 'ready',
        kind: document.previewKind,
        contentType:
          document.previewKind === 'pdf'
            ? 'application/pdf'
            : document.previewKind === 'svg'
              ? 'image/svg+xml'
              : 'application/vnd.nexuskb.cad-tiles+json',
        renderer: document.previewRenderer,
        rendererVersion: document.previewRendererVersion,
        generatedAt: document.previewGeneratedAt?.toISOString() ?? null,
        fallbackVersion: null,
        cad,
      };
    }
    const fallbackVersion =
      document.versions.find(
        (version) => version.version === document.activeVersion && version.chunkCount > 0,
      )?.version ?? document.versions.find((version) => version.chunkCount > 0)?.version;
    if (fallbackVersion) {
      return {
        documentId: document.id,
        sourceName: document.sourceName,
        sourceMimeType: document.mimeType,
        status: 'fallback',
        kind: 'extracted',
        contentType: null,
        renderer: null,
        rendererVersion: null,
        generatedAt: null,
        fallbackVersion,
        cad: null,
      };
    }
    return {
      documentId: document.id,
      sourceName: document.sourceName,
      sourceMimeType: document.mimeType,
      status: 'unavailable',
      kind: null,
      contentType: null,
      renderer: null,
      rendererVersion: null,
      generatedAt: null,
      fallbackVersion: null,
      cad: null,
    };
  }

  async getDocumentPreviewContent(
    id: string,
    identity: Identity,
  ): Promise<{
    path: string;
    size: number;
    mimeType: string;
    sourceName: string;
    kind: 'pdf' | 'image' | 'text' | 'markdown' | 'svg';
    contentEncoding?: 'gzip';
  }> {
    this.acl.assertCapability(identity, 'documents:read');
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        ...this.acl.documentWhere(identity),
        status: { notIn: ['deleting', 'deleted'] },
      },
      select: {
        sourceName: true,
        storageKey: true,
        mimeType: true,
        previewStorageKey: true,
        previewKind: true,
        previewMimeType: true,
        previewRenderer: true,
      },
    });
    if (!document) throw new ApiException('DOCUMENT_NOT_FOUND', '文档不存在', 404);

    const direct = this.directPreview(document.mimeType, document.sourceName);
    if (direct) {
      const file = await this.resolveStoredFile(
        this.config.values.RAW_DOCS_PATH,
        document.storageKey,
      );
      return {
        path: file.path,
        size: file.size,
        mimeType: direct.contentType,
        sourceName: document.sourceName,
        kind: direct.kind,
      };
    }
    if (
      document.previewStorageKey &&
      this.isStreamedGeneratedPreview(document.previewKind, document.previewMimeType) &&
      extname(document.previewStorageKey) === `.${document.previewKind}`
    ) {
      const file = await this.resolveStoredFile(
        this.config.values.PREVIEW_ARTIFACTS_PATH,
        document.previewStorageKey,
      );
      return {
        path: file.path,
        size: file.size,
        mimeType: document.previewKind === 'pdf' ? 'application/pdf' : 'image/svg+xml',
        sourceName: document.sourceName,
        kind: document.previewKind,
        ...(document.previewRenderer === 'ezdxf-svg-gzip'
          ? { contentEncoding: 'gzip' as const }
          : {}),
      };
    }
    throw new ApiException('DOCUMENT_PREVIEW_NOT_READY', '文档预览内容尚未生成', 409);
  }

  async getDocumentPreviewOverview(
    id: string,
    identity: Identity,
  ): Promise<{ path: string; size: number; mimeType: 'image/png'; sourceName: string }> {
    const document = await this.getVisibleCadPreviewDocument(id, identity);
    const current = await this.resolveCadPreviewBundle(id, document.previewStorageKey);
    const file = await this.resolveNestedPreviewFile(
      `${document.previewStorageKey}/bundles/${current.bundleId}/overview.png`,
      `${document.previewStorageKey}/bundles/${current.bundleId}/`,
    );
    return { ...file, mimeType: 'image/png', sourceName: document.sourceName };
  }

  async getDocumentPreviewTile(
    id: string,
    zoom: number,
    tileX: number,
    tileY: number,
    identity: Identity,
    traceId: string,
  ): Promise<{
    path: string;
    size: number;
    mimeType: 'image/png';
    sourceName: string;
    cacheHit: boolean;
  }> {
    const document = await this.getVisibleCadPreviewDocument(id, identity);
    const manifest = await this.readCadPreviewManifest(id, document.previewStorageKey);
    this.assertCadTileCoordinates(manifest, zoom, tileX, tileY);
    if (!this.parserClient) {
      throw new ApiException('CAD_PREVIEW_TILE_UNAVAILABLE', 'CAD 预览瓦片服务暂不可用', 503);
    }
    let tile;
    try {
      tile = await this.parserClient.ensureCadPreviewTile(
        { documentId: id, zoom, tileX, tileY },
        traceId,
      );
    } catch (error) {
      if (error instanceof ParserError) {
        const status =
          error.kind === 'timeout' ? 504 : error.kind === 'invalid_request' ? 400 : 503;
        throw new ApiException(
          error.code.startsWith('CAD_PREVIEW_') ? error.code : 'CAD_PREVIEW_TILE_UNAVAILABLE',
          error.kind === 'timeout' ? 'CAD 预览瓦片生成超时' : 'CAD 预览瓦片暂不可用',
          status,
        );
      }
      throw error;
    }
    const stillVisible = await this.prisma.document.findFirst({
      where: {
        id,
        ...this.acl.documentWhere(identity),
        status: { notIn: ['deleting', 'deleted'] },
        previewStorageKey: document.previewStorageKey,
        previewKind: 'cad_tiles',
      },
      select: { id: true },
    });
    if (!stillVisible) throw new ApiException('DOCUMENT_NOT_FOUND', '文档不存在', 404);
    const expectedPrefix = `${document.previewStorageKey}/bundles/`;
    const expectedSuffix = `/tiles/${zoom}/${tileX}/${tileY}.png`;
    if (!tile.storageKey.startsWith(expectedPrefix) || !tile.storageKey.endsWith(expectedSuffix)) {
      throw new ApiException('PREVIEW_STORAGE_INVALID', '预览产物引用不合法', 500);
    }
    const file = await this.resolveNestedPreviewFile(tile.storageKey, expectedPrefix);
    return {
      ...file,
      mimeType: 'image/png',
      sourceName: document.sourceName,
      cacheHit: tile.cacheHit,
    };
  }

  async listDocumentChunks(
    id: string,
    request: DocumentChunkListRequest,
    identity: Identity,
  ): Promise<DocumentChunkListResponse> {
    this.acl.assertCapability(identity, 'documents:read');
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        ...this.acl.documentWhere(identity),
        status: { notIn: ['deleting', 'deleted'] },
      },
      select: {
        id: true,
        sourceName: true,
        activeVersion: true,
        versions: { select: { version: true }, orderBy: { version: 'desc' } },
      },
    });
    if (!document) throw new ApiException('DOCUMENT_NOT_FOUND', '文档不存在', 404);
    const documentVersion =
      request.version ?? document.activeVersion ?? document.versions[0]?.version;
    if (
      !documentVersion ||
      !document.versions.some((version) => version.version === documentVersion)
    ) {
      throw new ApiException('DOCUMENT_VERSION_NOT_FOUND', '文档版本不存在', 404);
    }
    const where: Prisma.KnowledgeChunkWhereInput = {
      tenantId: identity.tenantId,
      documentId: id,
      documentVersion,
      document: {
        is: {
          ...this.acl.documentWhere(identity),
          status: { notIn: ['deleting', 'deleted'] },
        },
      },
    };
    const [chunks, total] = await this.prisma.$transaction([
      this.prisma.knowledgeChunk.findMany({
        where,
        orderBy: { ordinal: 'asc' },
        skip: (request.page - 1) * request.pageSize,
        take: request.pageSize,
        select: {
          id: true,
          documentVersion: true,
          ordinal: true,
          originalText: true,
          redactedText: true,
          tokenCount: true,
          page: true,
          sheet: true,
          sectionPath: true,
          elementTypes: true,
          previousChunkId: true,
          nextChunkId: true,
          redactionPolicyVersion: true,
          redactionSummary: true,
          createdAt: true,
        },
      }),
      this.prisma.knowledgeChunk.count({ where }),
    ]);
    return {
      documentId: document.id,
      sourceName: document.sourceName,
      documentVersion,
      items: chunks.map((chunk) => ({
        ...chunk,
        sectionPath: this.stringArray(chunk.sectionPath),
        elementTypes: this.stringArray(chunk.elementTypes),
        redactionSummary: this.redactionSummary(chunk.redactionSummary),
        createdAt: chunk.createdAt.toISOString(),
      })),
      page: request.page,
      pageSize: request.pageSize,
      total,
    };
  }

  async listJobs(
    request: IngestionJobListRequest,
    identity: Identity,
  ): Promise<IngestionJobListResponse> {
    this.acl.assertCapability(identity, 'documents:read');
    const where: Prisma.IngestionJobWhereInput = {
      tenantId: identity.tenantId,
      ...(request.documentId ? { documentId: request.documentId } : {}),
      status: request.status ?? { not: 'deleted' },
      document: this.acl.documentWhere(identity),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ingestionJob.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (request.page - 1) * request.pageSize,
        take: request.pageSize,
        select: this.ingestionJobSelect(),
      }),
      this.prisma.ingestionJob.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.mapIngestionJob(row)),
      page: request.page,
      pageSize: request.pageSize,
      total,
    };
  }

  async getJob(id: string, identity: Identity): Promise<IngestionJob> {
    this.acl.assertCapability(identity, 'documents:read');
    const job = await this.prisma.ingestionJob.findFirst({
      where: {
        id,
        tenantId: identity.tenantId,
        status: { not: 'deleted' },
        document: this.acl.documentWhere(identity),
      },
      select: this.ingestionJobSelect(),
    });
    if (!job) throw new ApiException('INGESTION_JOB_NOT_FOUND', '入库任务不存在', 404);
    return this.mapIngestionJob(job);
  }

  async retryJob(id: string, identity: Identity, traceId: string): Promise<IngestionRetryAccepted> {
    this.acl.assertCapability(identity, 'documents:write');
    const job = await this.prisma.ingestionJob.findFirst({
      where: {
        id,
        tenantId: identity.tenantId,
        document: this.acl.documentWhere(identity),
      },
      select: {
        id: true,
        documentId: true,
        version: true,
        status: true,
        step: true,
        errorCode: true,
        errorCategory: true,
        retryable: true,
        completedAt: true,
        document: { select: { activeVersion: true, status: true, storageKey: true } },
      },
    });
    if (!job) throw new ApiException('INGESTION_JOB_NOT_FOUND', '入库任务不存在', 404);
    if (job.status !== 'failed' || !job.retryable) {
      throw new ApiException('INGESTION_JOB_NOT_RETRYABLE', '当前入库任务不可重试', 409);
    }
    const auditId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.ingestionJob.updateMany({
        where: {
          id: job.id,
          tenantId: identity.tenantId,
          status: 'failed',
          retryable: true,
        },
        data: {
          status: 'queued',
          step: 'queued',
          errorCode: null,
          errorCategory: null,
          retryable: false,
          startedAt: null,
          completedAt: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ApiException('INGESTION_JOB_NOT_RETRYABLE', '当前入库任务不可重试', 409);
      }
      await tx.document.update({
        where: { id: job.documentId },
        data: { status: job.document.activeVersion === null ? 'processing' : 'active' },
      });
      await tx.documentVersion.update({
        where: { documentId_version: { documentId: job.documentId, version: job.version } },
        data: { status: 'processing' },
      });
      await tx.documentLifecycleAudit.create({
        data: {
          id: auditId,
          tenantId: identity.tenantId,
          userId: identity.userId,
          traceId,
          documentId: job.documentId,
          documentVersion: job.version,
          ingestionJobId: job.id,
          eventType: 'ingestion_retry_requested',
          outcome: 'queued',
        },
      });
    });
    try {
      await this.queue.retry(job.id, {
        ingestionJobId: job.id,
        documentId: job.documentId,
        storageKey: job.document.storageKey,
      });
    } catch {
      await this.prisma.$transaction([
        this.prisma.ingestionJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            step: job.step,
            errorCode: job.errorCode,
            errorCategory: job.errorCategory,
            retryable: true,
            completedAt: job.completedAt,
          },
        }),
        this.prisma.documentVersion.update({
          where: { documentId_version: { documentId: job.documentId, version: job.version } },
          data: { status: 'failed' },
        }),
        this.prisma.document.update({
          where: { id: job.documentId },
          data: { status: job.document.status },
        }),
        this.prisma.documentLifecycleAudit.update({
          where: { id: auditId },
          data: { outcome: 'enqueue_failed' },
        }),
      ]);
      this.logger.error('ingestion_retry_enqueue_failed', {
        traceId,
        tenantId: identity.tenantId,
        userId: identity.userId,
        jobId: job.id,
        documentId: job.documentId,
        status: 'failed',
      });
      throw new ApiException('INGESTION_RETRY_FAILED', '入库任务重新排队失败', 503);
    }
    return { jobId: job.id, status: 'queued', traceId };
  }

  async getFailedJobs(identity: Identity): Promise<object> {
    this.acl.assertCapability(identity, 'documents:read');
    const jobs = await this.prisma.ingestionJob.findMany({
      where: {
        tenantId: identity.tenantId,
        status: 'failed',
        document: this.acl.documentWhere(identity),
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        documentId: true,
        version: true,
        kind: true,
        status: true,
        step: true,
        checkpoint: true,
        attempts: true,
        traceId: true,
        errorCode: true,
        errorCategory: true,
        retryable: true,
        startedAt: true,
        completedAt: true,
        updatedAt: true,
      },
    });
    return { jobs };
  }

  async reindexDocument(id: string, identity: Identity, traceId: string): Promise<object> {
    this.acl.assertCapability(identity, 'documents:write');
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        ...this.acl.documentWhere(identity),
        status: { notIn: ['deleting', 'deleted'] },
      },
      select: {
        id: true,
        storageKey: true,
        activeVersion: true,
        status: true,
        versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } },
      },
    });
    if (!document) throw new ApiException('DOCUMENT_NOT_FOUND', '文档不存在', 404);
    if (document.activeVersion === null && document.status === 'prepared') {
      return this.resumePreparedDocument(document, identity, traceId);
    }
    if (document.activeVersion === null || document.status !== 'active') {
      throw new ApiException('DOCUMENT_NOT_ACTIVE', '只有已生效文档可以重新索引', 409);
    }
    const runningJob = await this.prisma.ingestionJob.findFirst({
      where: {
        tenantId: identity.tenantId,
        documentId: document.id,
        status: {
          in: [
            'queued',
            'converting',
            'parsing',
            'chunking',
            'policy_check',
            'embedding',
            'indexing',
          ],
        },
      },
      select: { id: true },
    });
    if (runningJob) {
      throw new ApiException('DOCUMENT_REINDEX_IN_PROGRESS', '文档已有正在执行的入库任务', 409);
    }
    const nextVersion = (document.versions[0]?.version ?? document.activeVersion) + 1;
    const jobId = randomUUID();
    try {
      await this.prisma.$transaction([
        this.prisma.documentVersion.create({
          data: {
            id: randomUUID(),
            tenantId: identity.tenantId,
            documentId: document.id,
            version: nextVersion,
            status: 'processing',
          },
        }),
        this.prisma.ingestionJob.create({
          data: {
            id: jobId,
            tenantId: identity.tenantId,
            documentId: document.id,
            version: nextVersion,
            kind: 'reindex',
            traceId,
          },
        }),
        this.prisma.documentLifecycleAudit.create({
          data: {
            id: randomUUID(),
            tenantId: identity.tenantId,
            userId: identity.userId,
            traceId,
            documentId: document.id,
            documentVersion: nextVersion,
            ingestionJobId: jobId,
            eventType: 'document_reindex_requested',
            outcome: 'queued',
          },
        }),
      ]);
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ApiException('DOCUMENT_REINDEX_CONFLICT', '文档版本已发生变化，请重试', 409);
      }
      throw error;
    }
    try {
      await this.queue.enqueue({
        ingestionJobId: jobId,
        documentId: document.id,
        storageKey: document.storageKey,
      });
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.ingestionJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            step: 'failed',
            errorCode: 'QUEUE_UNAVAILABLE',
            errorCategory: 'queue',
            retryable: true,
            completedAt: new Date(),
          },
        }),
        this.prisma.documentVersion.update({
          where: { documentId_version: { documentId: document.id, version: nextVersion } },
          data: { status: 'failed' },
        }),
      ]);
      throw error;
    }
    this.logger.info('document_reindex_queued', {
      traceId,
      tenantId: identity.tenantId,
      userId: identity.userId,
      jobId,
      documentId: document.id,
      status: 'queued',
    });
    return {
      documentId: document.id,
      documentVersion: nextVersion,
      jobId,
      status: 'queued',
      traceId,
    };
  }

  private async resumePreparedDocument(
    document: {
      id: string;
      storageKey: string;
      versions: Array<{ version: number }>;
    },
    identity: Identity,
    traceId: string,
  ): Promise<object> {
    const version = document.versions[0]?.version;
    if (!version) {
      throw new ApiException(
        'DOCUMENT_PREPARED_VERSION_NOT_FOUND',
        '待建立索引文档缺少可恢复版本',
        409,
      );
    }
    const job = await this.prisma.ingestionJob.findFirst({
      where: {
        tenantId: identity.tenantId,
        documentId: document.id,
        version,
        status: 'completed',
        checkpoint: 'prepared',
      },
      select: { id: true },
    });
    if (!job) {
      throw new ApiException(
        'DOCUMENT_PREPARED_JOB_NOT_FOUND',
        '待建立索引文档缺少可恢复任务',
        409,
      );
    }

    const auditId = randomUUID();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const jobUpdate = await tx.ingestionJob.updateMany({
        where: { id: job.id, status: 'completed', checkpoint: 'prepared' },
        data: {
          status: 'queued',
          step: 'queued',
          checkpoint: 'local_prepared',
          completedAt: null,
          errorCode: null,
          errorCategory: null,
          retryable: false,
        },
      });
      if (jobUpdate.count !== 1) return false;
      await tx.document.update({ where: { id: document.id }, data: { status: 'processing' } });
      await tx.documentVersion.update({
        where: { documentId_version: { documentId: document.id, version } },
        data: { status: 'processing' },
      });
      await tx.documentLifecycleAudit.create({
        data: {
          id: auditId,
          tenantId: identity.tenantId,
          userId: identity.userId,
          traceId,
          documentId: document.id,
          documentVersion: version,
          ingestionJobId: job.id,
          eventType: 'document_prepared_index_resume_requested',
          outcome: 'queued',
        },
      });
      return true;
    });
    if (!claimed) {
      throw new ApiException(
        'DOCUMENT_PREPARED_RESUME_CONFLICT',
        '待建立索引文档状态已发生变化，请刷新后重试',
        409,
      );
    }

    try {
      await this.queue.enqueue({
        ingestionJobId: job.id,
        documentId: document.id,
        storageKey: document.storageKey,
      });
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.ingestionJob.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            step: 'prepared',
            checkpoint: 'prepared',
            completedAt: new Date(),
          },
        }),
        this.prisma.document.update({ where: { id: document.id }, data: { status: 'prepared' } }),
        this.prisma.documentVersion.update({
          where: { documentId_version: { documentId: document.id, version } },
          data: { status: 'prepared' },
        }),
      ]);
      throw error;
    }

    this.logger.info('document_prepared_index_resume_queued', {
      traceId,
      tenantId: identity.tenantId,
      userId: identity.userId,
      jobId: job.id,
      documentId: document.id,
      status: 'queued',
    });
    return {
      documentId: document.id,
      documentVersion: version,
      jobId: job.id,
      status: 'queued',
      traceId,
    };
  }

  async updateMetadata(
    id: string,
    request: DocumentMetadataUpdateRequest,
    identity: Identity,
    traceId: string,
  ): Promise<object> {
    this.acl.assertCapability(identity, 'documents:write');
    if (!identity.allowedSensitivities.includes(request.sensitivity)) {
      throw new ApiException('SENSITIVITY_FORBIDDEN', '不能设置超出身份范围的敏感度', 403);
    }
    const tenantWide = isAdmin(identity.roles);
    if (!tenantWide && request.department !== identity.department) {
      throw new ApiException('DEPARTMENT_FORBIDDEN', '不能把文档移动到其他部门', 403);
    }
    const document = await this.prisma.document.findFirst({
      where: { id, ...this.acl.documentWhere(identity), status: 'active' },
      select: {
        id: true,
        contentSha256: true,
        ownerId: true,
        department: true,
        sensitivity: true,
      },
    });
    if (!document) throw new ApiException('DOCUMENT_NOT_FOUND', '文档不存在或尚未生效', 404);
    if (
      document.department === request.department &&
      document.sensitivity === request.sensitivity
    ) {
      throw new ApiException('DOCUMENT_METADATA_UNCHANGED', '文档 metadata 未发生变化', 409);
    }
    const runningJob = await this.prisma.ingestionJob.findFirst({
      where: {
        tenantId: identity.tenantId,
        documentId: document.id,
        status: {
          in: [
            'queued',
            'converting',
            'parsing',
            'chunking',
            'policy_check',
            'embedding',
            'indexing',
          ],
        },
      },
      select: { id: true },
    });
    if (runningJob) {
      throw new ApiException('DOCUMENT_REINDEX_IN_PROGRESS', '文档已有正在执行的入库任务', 409);
    }
    const deduplicationKey = createHash('sha256')
      .update(
        [
          identity.tenantId,
          document.contentSha256,
          request.department,
          request.sensitivity,
          document.ownerId,
        ].join('\0'),
      )
      .digest('hex');
    try {
      await this.prisma.$transaction([
        this.prisma.document.update({
          where: { id: document.id },
          data: {
            department: request.department,
            sensitivity: request.sensitivity,
            deduplicationKey,
          },
        }),
        this.prisma.documentLifecycleAudit.create({
          data: {
            id: randomUUID(),
            tenantId: identity.tenantId,
            userId: identity.userId,
            traceId,
            documentId: document.id,
            eventType: 'document_metadata_updated',
            outcome: 'reindex_required',
          },
        }),
      ]);
    } catch (error) {
      if (this.isUniqueConflict(error)) throw this.duplicateError();
      throw error;
    }
    return this.reindexDocument(id, identity, traceId);
  }

  async deleteDocument(id: string, identity: Identity, traceId: string): Promise<object> {
    this.acl.assertCapability(identity, 'documents:delete');
    const document = await this.prisma.document.findFirst({
      where: { id, ...this.acl.documentWhere(identity) },
      select: {
        id: true,
        storageKey: true,
        previewStorageKey: true,
        status: true,
        activeVersion: true,
        versions: { select: { vectorCollection: true } },
        jobs: { select: { vectorCollection: true } },
      },
    });
    if (!document) return { documentId: id, deleted: true };
    if (document.status !== 'deleting') {
      await this.prisma.$transaction([
        this.prisma.document.update({
          where: { id: document.id },
          data: { status: 'deleting', activeVersion: null },
        }),
        this.prisma.ingestionJob.updateMany({
          where: { documentId: document.id, tenantId: identity.tenantId },
          data: { status: 'deleted', step: 'deleted', completedAt: new Date() },
        }),
      ]);
    }
    const vectorCollections = [...document.versions, ...document.jobs]
      .map((record) => record.vectorCollection)
      .filter((name): name is string => name !== null);
    if (vectorCollections.length > 0) {
      await this.vectorStore.deleteDocumentFromCollections(
        identity.tenantId,
        document.id,
        vectorCollections,
      );
    } else {
      await this.vectorStore.deleteDocument(identity.tenantId, document.id);
    }
    await unlink(join(this.config.values.RAW_DOCS_PATH, document.storageKey)).catch(
      (error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      },
    );
    if (document.previewStorageKey) {
      if (document.previewStorageKey !== basename(document.previewStorageKey)) {
        throw new ApiException('PREVIEW_STORAGE_INVALID', '预览产物引用不合法', 500);
      }
      const previewPath = join(
        this.config.values.PREVIEW_ARTIFACTS_PATH,
        document.previewStorageKey,
      );
      if (document.previewStorageKey === `${document.id}.cad`) {
        const metadata = await lstat(previewPath).catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
          throw error;
        });
        if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink())) {
          throw new ApiException('PREVIEW_STORAGE_INVALID', 'CAD 预览产物引用不合法', 500);
        }
        await rm(previewPath, { recursive: true, force: true });
        const lockPath = join(
          this.config.values.PREVIEW_ARTIFACTS_PATH,
          `.${document.id}.cad.lock`,
        );
        const lockMetadata = await lstat(lockPath).catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
          throw error;
        });
        if (lockMetadata && (!lockMetadata.isFile() || lockMetadata.isSymbolicLink())) {
          throw new ApiException('PREVIEW_STORAGE_INVALID', 'CAD 预览锁文件不合法', 500);
        }
        await unlink(lockPath).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        });
      } else {
        await unlink(previewPath).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        });
      }
    }
    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: 'deleted',
          deletedAt: new Date(),
          activeVersion: null,
          previewStorageKey: null,
          previewKind: null,
          previewMimeType: null,
          previewSizeBytes: null,
          previewRenderer: null,
          previewRendererVersion: null,
          previewGeneratedAt: null,
        },
      }),
      this.prisma.documentVersion.updateMany({
        where: { documentId: document.id, tenantId: identity.tenantId },
        data: {
          status: 'deleted',
          parsedElements: Prisma.DbNull,
          warnings: Prisma.DbNull,
          chunkCount: 0,
          redactionPolicyVersion: null,
          cloudPolicyDecision: null,
          embeddingFingerprint: null,
          vectorCollection: null,
          indexedAt: null,
        },
      }),
      this.prisma.knowledgeChunk.deleteMany({
        where: { documentId: document.id, tenantId: identity.tenantId },
      }),
      this.prisma.documentLifecycleAudit.create({
        data: {
          id: randomUUID(),
          tenantId: identity.tenantId,
          userId: identity.userId,
          traceId,
          documentId: document.id,
          documentVersion: document.activeVersion,
          eventType: 'document_deleted',
          outcome: 'completed',
        },
      }),
    ]);
    return { documentId: id, deleted: true };
  }

  private duplicateError(): ApiException {
    return new ApiException('DOCUMENT_DUPLICATE', '相同权限范围内已存在内容相同的文档', 409);
  }

  private directPreview(
    mimeType: string,
    sourceName: string,
  ): { kind: 'pdf' | 'image' | 'text' | 'markdown'; contentType: string } | undefined {
    const extension = extname(sourceName).toLowerCase();
    if (mimeType === 'application/pdf' && extension === '.pdf') {
      return { kind: 'pdf', contentType: 'application/pdf' };
    }
    if (mimeType === 'image/png' && extension === '.png') {
      return { kind: 'image', contentType: 'image/png' };
    }
    if (mimeType === 'image/jpeg' && (extension === '.jpg' || extension === '.jpeg')) {
      return { kind: 'image', contentType: 'image/jpeg' };
    }
    if (mimeType === 'text/plain' && extension === '.txt') {
      return { kind: 'text', contentType: 'text/plain; charset=utf-8' };
    }
    if (mimeType === 'text/markdown' && extension === '.md') {
      return { kind: 'markdown', contentType: 'text/markdown; charset=utf-8' };
    }
    return undefined;
  }

  private isGeneratedPreview(
    kind: string | null,
    mimeType: string | null,
  ): kind is 'pdf' | 'svg' | 'cad_tiles' {
    return (
      (kind === 'pdf' && mimeType === 'application/pdf') ||
      (kind === 'svg' && mimeType === 'image/svg+xml') ||
      (kind === 'cad_tiles' && mimeType === 'application/vnd.nexuskb.cad-tiles+json')
    );
  }

  private isStreamedGeneratedPreview(
    kind: string | null,
    mimeType: string | null,
  ): kind is 'pdf' | 'svg' {
    return (
      (kind === 'pdf' && mimeType === 'application/pdf') ||
      (kind === 'svg' && mimeType === 'image/svg+xml')
    );
  }

  private previewStorageKeyMatches(
    documentId: string,
    storageKey: string,
    kind: 'pdf' | 'svg' | 'cad_tiles',
  ): boolean {
    return storageKey === `${documentId}.${kind === 'cad_tiles' ? 'cad' : kind}`;
  }

  private async getVisibleCadPreviewDocument(
    id: string,
    identity: Identity,
  ): Promise<{ sourceName: string; previewStorageKey: string }> {
    this.acl.assertCapability(identity, 'documents:read');
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        ...this.acl.documentWhere(identity),
        status: { notIn: ['deleting', 'deleted'] },
      },
      select: {
        sourceName: true,
        previewStorageKey: true,
        previewKind: true,
        previewMimeType: true,
      },
    });
    if (
      !document ||
      document.previewStorageKey !== `${id}.cad` ||
      document.previewKind !== 'cad_tiles' ||
      document.previewMimeType !== 'application/vnd.nexuskb.cad-tiles+json'
    ) {
      throw new ApiException('DOCUMENT_PREVIEW_NOT_READY', 'CAD 瓦片预览尚未生成', 409);
    }
    return { sourceName: document.sourceName, previewStorageKey: document.previewStorageKey };
  }

  private async readCadPreviewManifest(
    documentId: string,
    storageKey: string,
  ): Promise<CadPreviewManifest> {
    const current = await this.resolveCadPreviewBundle(documentId, storageKey);
    const file = await this.resolveNestedPreviewFile(
      `${storageKey}/bundles/${current.bundleId}/manifest.json`,
      `${storageKey}/bundles/${current.bundleId}/`,
    );
    try {
      return cadPreviewManifestSchema.parse(JSON.parse(await readFile(file.path, 'utf8')));
    } catch (error) {
      this.logger.warn('cad preview manifest rejected', {
        documentId,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
      throw new ApiException('PREVIEW_STORAGE_INVALID', 'CAD 预览清单无效', 500);
    }
  }

  private async resolveCadPreviewBundle(
    documentId: string,
    storageKey: string,
  ): Promise<{ bundleId: string }> {
    if (storageKey !== `${documentId}.cad`) {
      throw new ApiException('PREVIEW_STORAGE_INVALID', '预览产物引用不合法', 500);
    }
    const rootPath = await realpath(this.config.values.PREVIEW_ARTIFACTS_PATH);
    const cadRoot = resolve(rootPath, storageKey);
    try {
      const metadata = await lstat(cadRoot);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('invalid CAD root');
      const resolvedCadRoot = await realpath(cadRoot);
      if (relative(rootPath, resolvedCadRoot).startsWith('..')) throw new Error('escaped root');
      const currentFile = resolve(resolvedCadRoot, 'current.json');
      const currentMetadata = await lstat(currentFile);
      if (!currentMetadata.isFile() || currentMetadata.isSymbolicLink()) {
        throw new Error('invalid current pointer');
      }
      const parsed = JSON.parse(await readFile(currentFile, 'utf8')) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('bundleId' in parsed) ||
        typeof parsed.bundleId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsed.bundleId,
        )
      ) {
        throw new Error('invalid bundle pointer');
      }
      return { bundleId: parsed.bundleId };
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException('PREVIEW_STORAGE_INVALID', 'CAD 预览存储引用不合法', 500);
    }
  }

  private async resolveNestedPreviewFile(
    storageKey: string,
    expectedPrefix: string,
  ): Promise<{ path: string; size: number }> {
    if (
      !storageKey.startsWith(expectedPrefix) ||
      storageKey.includes('\0') ||
      storageKey.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new ApiException('PREVIEW_STORAGE_INVALID', '预览产物引用不合法', 500);
    }
    try {
      const rootPath = await realpath(this.config.values.PREVIEW_ARTIFACTS_PATH);
      const candidate = resolve(rootPath, storageKey);
      if (relative(rootPath, candidate).startsWith('..')) throw new Error('escaped root');
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) {
        throw new Error('invalid nested preview file');
      }
      const resolved = await realpath(candidate);
      if (relative(rootPath, resolved).startsWith('..')) throw new Error('escaped root');
      return { path: resolved, size: metadata.size };
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException('PREVIEW_STORAGE_INVALID', '预览产物引用不合法', 500);
    }
  }

  private assertCadTileCoordinates(
    manifest: CadPreviewManifest,
    zoom: number,
    tileX: number,
    tileY: number,
  ): void {
    if (
      !Number.isInteger(zoom) ||
      !Number.isInteger(tileX) ||
      !Number.isInteger(tileY) ||
      zoom < manifest.minZoom ||
      zoom > manifest.maxZoom
    ) {
      throw new ApiException('CAD_PREVIEW_TILE_INVALID', 'CAD 预览瓦片坐标不合法', 400);
    }
    const multiplier = 2 ** zoom;
    const gridWidth = Math.max(1, Math.ceil((manifest.baseWidth * multiplier) / manifest.tileSize));
    const gridHeight = Math.max(
      1,
      Math.ceil((manifest.baseHeight * multiplier) / manifest.tileSize),
    );
    if (tileX < 0 || tileY < 0 || tileX >= gridWidth || tileY >= gridHeight) {
      throw new ApiException('CAD_PREVIEW_TILE_INVALID', 'CAD 预览瓦片坐标不合法', 400);
    }
  }

  private async resolveStoredFile(
    root: string,
    storageKey: string,
  ): Promise<{ path: string; size: number }> {
    if (!storageKey || storageKey !== basename(storageKey) || storageKey.includes('\0')) {
      throw new ApiException('PREVIEW_STORAGE_INVALID', '预览存储引用不合法', 500);
    }
    try {
      const rootPath = await realpath(root);
      const candidate = resolve(rootPath, storageKey);
      const relativePath = relative(rootPath, candidate);
      if (relativePath.startsWith('..') || relativePath === '' || relativePath.includes('\0')) {
        throw new Error('invalid storage path');
      }
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) {
        throw new Error('not a non-empty regular file');
      }
      const filePath = await realpath(candidate);
      const realRelativePath = relative(rootPath, filePath);
      if (realRelativePath.startsWith('..') || realRelativePath === '') {
        throw new Error('storage path escaped root');
      }
      return { path: filePath, size: metadata.size };
    } catch (error) {
      if (error instanceof ApiException) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ApiException('DOCUMENT_PREVIEW_MISSING', '文档预览内容不存在', 404);
      }
      throw new ApiException('PREVIEW_STORAGE_INVALID', '预览存储引用不合法', 500);
    }
  }

  private ingestionJobSelect() {
    return {
      id: true,
      documentId: true,
      version: true,
      kind: true,
      status: true,
      step: true,
      checkpoint: true,
      attempts: true,
      traceId: true,
      parserVersion: true,
      embeddingFingerprint: true,
      warnings: true,
      errorCode: true,
      errorCategory: true,
      retryable: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      document: { select: { sourceName: true, mimeType: true } },
    } as const;
  }

  private mapIngestionJob(row: {
    id: string;
    documentId: string;
    version: number;
    kind: string;
    status: IngestionJob['status'];
    step: string;
    checkpoint: string;
    attempts: number;
    traceId: string;
    parserVersion: string | null;
    embeddingFingerprint: string | null;
    warnings: unknown;
    errorCode: string | null;
    errorCategory: string | null;
    retryable: boolean;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    document: { sourceName: string; mimeType: string };
  }): IngestionJob {
    const { document, ...job } = row;
    return {
      ...job,
      sourceName: document.sourceName,
      mimeType: document.mimeType,
      kind: job.kind as IngestionJob['kind'],
      warnings: this.stringArray(job.warnings),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }

  private redactionSummary(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const entries: Array<[string, number]> = [];
    for (const [key, count] of Object.entries(value)) {
      if (key.length > 0 && typeof count === 'number' && Number.isInteger(count) && count >= 0) {
        entries.push([key, count]);
      }
    }
    return Object.fromEntries(entries);
  }

  private isUniqueConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError ||
      (typeof error === 'object' && error !== null && 'code' in error)
      ? (error as { code?: unknown }).code === 'P2002'
      : false;
  }
}
