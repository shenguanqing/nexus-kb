import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import { Prisma } from '@prisma/client';

import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { IngestionQueue } from '../ingestion/ingestion.queue';
import { validateUploadedFile } from './file-validation';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly queue: IngestionQueue,
  ) {}

  async upload(file: MultipartFile, identity: Identity, traceId: string): Promise<object> {
    const sourceName = file.filename.normalize('NFC');
    if (!sourceName || sourceName !== basename(sourceName) || sourceName.includes('\0')) {
      throw new ApiException('INVALID_FILENAME', '文件名不合法', 400);
    }
    const documentId = randomUUID();
    const jobId = randomUUID();
    const temporaryKey = `.upload-${documentId}`;
    const temporaryPath = join(this.config.values.RAW_DOCS_PATH, temporaryKey);
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
      const validated = await validateUploadedFile(temporaryPath, sourceName, file.mimetype);
      const storageKey = `${documentId}${validated.extension}`;
      await rename(temporaryPath, join(this.config.values.RAW_DOCS_PATH, storageKey));

      await this.prisma.$transaction(async (tx) => {
        await tx.document.create({
          data: {
            id: documentId,
            tenantId: identity.tenantId,
            sourceName,
            storageKey,
            mimeType: validated.mimeType,
            contentSha256: hash.digest('hex'),
            department: identity.department,
            sensitivity: identity.sensitivity,
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
      try {
        await this.queue.enqueue({ ingestionJobId: jobId, documentId, storageKey });
      } catch (error) {
        await this.prisma.ingestionJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            step: 'failed',
            errorCode: 'QUEUE_UNAVAILABLE',
            completedAt: new Date(),
          },
        });
        throw error;
      }
      return { documentId, jobId, status: 'queued', traceId };
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async getDocument(id: string, identity: Identity): Promise<object> {
    const document = await this.prisma.document.findFirst({
      where: { id, tenantId: identity.tenantId, status: { not: 'deleted' } },
      select: {
        id: true,
        sourceName: true,
        mimeType: true,
        contentSha256: true,
        department: true,
        sensitivity: true,
        ownerId: true,
        activeVersion: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!document) throw new ApiException('DOCUMENT_NOT_FOUND', '文档不存在', 404);
    return document;
  }

  async getJob(id: string, identity: Identity): Promise<object> {
    const job = await this.prisma.ingestionJob.findFirst({
      where: { id, tenantId: identity.tenantId, status: { not: 'deleted' } },
      select: {
        id: true,
        documentId: true,
        version: true,
        status: true,
        step: true,
        attempts: true,
        traceId: true,
        parserVersion: true,
        warnings: true,
        errorCode: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!job) throw new ApiException('INGESTION_JOB_NOT_FOUND', '入库任务不存在', 404);
    return job;
  }

  async deleteDocument(id: string, identity: Identity): Promise<object> {
    const document = await this.prisma.document.findFirst({
      where: { id, tenantId: identity.tenantId },
      select: { id: true, storageKey: true, status: true },
    });
    if (!document || document.status === 'deleted') return { documentId: id, deleted: true };
    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: document.id },
        data: { status: 'deleted', deletedAt: new Date(), activeVersion: null },
      }),
      this.prisma.ingestionJob.updateMany({
        where: { documentId: document.id, tenantId: identity.tenantId },
        data: { status: 'deleted', step: 'deleted', completedAt: new Date() },
      }),
      this.prisma.documentVersion.updateMany({
        where: { documentId: document.id, tenantId: identity.tenantId },
        data: {
          parsedElements: Prisma.DbNull,
          warnings: Prisma.DbNull,
          chunkCount: 0,
          redactionPolicyVersion: null,
          cloudPolicyDecision: null,
        },
      }),
      this.prisma.knowledgeChunk.deleteMany({
        where: { documentId: document.id, tenantId: identity.tenantId },
      }),
    ]);
    await unlink(join(this.config.values.RAW_DOCS_PATH, document.storageKey)).catch(
      (error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      },
    );
    return { documentId: id, deleted: true };
  }
}
