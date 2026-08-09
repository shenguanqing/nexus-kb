import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  documentChunkListRequestSchema,
  documentListRequestSchema,
  documentMetadataUpdateRequestSchema,
  ingestionJobListRequestSchema,
} from '@nexus-kb/contracts';
import type {
  DocumentDetail,
  DocumentChunkListResponse,
  DocumentListResponse,
  DocumentPreview,
  DocumentUploadOptions,
  IngestionJob,
  IngestionJobListResponse,
  IngestionRetryAccepted,
} from '@nexus-kb/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';

import { requestIdentity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { DocumentsService } from './documents.service';

@Controller('v1')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('documents')
  list(@Query() query: unknown, @Req() request: FastifyRequest): Promise<DocumentListResponse> {
    const parsed = documentListRequestSchema.safeParse(query);
    if (!parsed.success) {
      throw new ApiException('DOCUMENT_LIST_QUERY_INVALID', '文档列表查询参数不合法', 400);
    }
    return this.documents.listDocuments(parsed.data, requestIdentity(request));
  }

  @Get('documents/upload-options')
  uploadOptions(@Req() request: FastifyRequest): DocumentUploadOptions {
    return this.documents.getUploadOptions(requestIdentity(request));
  }

  @Post('documents')
  @HttpCode(202)
  async upload(@Req() request: FastifyRequest): Promise<object> {
    const file = await request.file();
    if (!file) throw new ApiException('FILE_REQUIRED', '必须上传一个文件', 400);
    return this.documents.upload(file, requestIdentity(request), request.id);
  }

  @Get('documents/:documentId')
  getDocument(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
  ): Promise<DocumentDetail> {
    return this.documents.getDocument(documentId, requestIdentity(request));
  }

  @Get('documents/:documentId/preview')
  getDocumentPreview(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
  ): Promise<DocumentPreview> {
    return this.documents.getDocumentPreview(documentId, requestIdentity(request));
  }

  @Get('documents/:documentId/preview/content')
  async getDocumentPreviewContent(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const content = await this.documents.getDocumentPreviewContent(
      documentId,
      requestIdentity(request),
    );
    const range = parseSingleByteRange(request.headers.range, content.size);
    if (request.headers.range && !range) {
      reply.header('content-range', `bytes */${content.size}`);
      throw new ApiException('PREVIEW_RANGE_INVALID', '预览范围请求不合法', 416);
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? content.size - 1;
    const contentLength = end - start + 1;
    reply.header('accept-ranges', 'bytes');
    reply.header('cache-control', 'private, no-store');
    reply.header('content-type', content.mimeType);
    reply.header('content-length', String(contentLength));
    if (content.contentEncoding) reply.header('content-encoding', content.contentEncoding);
    reply.header('content-disposition', inlineDisposition(content.sourceName));
    reply.header('x-content-type-options', 'nosniff');
    if (content.kind === 'svg') {
      reply.header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
    if (range) {
      reply.status(206);
      reply.header('content-range', `bytes ${start}-${end}/${content.size}`);
    }
    return new StreamableFile(createReadStream(content.path, { start, end }));
  }

  @Get('documents/:documentId/preview/overview')
  async getDocumentPreviewOverview(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const overview = await this.documents.getDocumentPreviewOverview(
      documentId,
      requestIdentity(request),
    );
    reply.header('cache-control', 'private, no-store');
    reply.header('content-type', overview.mimeType);
    reply.header('content-length', String(overview.size));
    reply.header('content-disposition', inlineDisposition(overview.sourceName));
    reply.header('x-content-type-options', 'nosniff');
    return new StreamableFile(createReadStream(overview.path));
  }

  @Get('documents/:documentId/preview/tiles/:zoom/:tileX/:tileY')
  async getDocumentPreviewTile(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Param('zoom', ParseIntPipe) zoom: number,
    @Param('tileX', ParseIntPipe) tileX: number,
    @Param('tileY', ParseIntPipe) tileY: number,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const tile = await this.documents.getDocumentPreviewTile(
      documentId,
      zoom,
      tileX,
      tileY,
      requestIdentity(request),
      request.id,
    );
    reply.header('cache-control', 'private, no-store');
    reply.header('content-type', tile.mimeType);
    reply.header('content-length', String(tile.size));
    reply.header('content-disposition', inlineDisposition(tile.sourceName));
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-cad-tile-cache', tile.cacheHit ? 'hit' : 'miss');
    return new StreamableFile(createReadStream(tile.path));
  }

  @Get('documents/:documentId/chunks')
  listDocumentChunks(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<DocumentChunkListResponse> {
    const parsed = documentChunkListRequestSchema.safeParse(query);
    if (!parsed.success) {
      throw new ApiException('DOCUMENT_CHUNK_LIST_QUERY_INVALID', '分块查询参数不合法', 400);
    }
    return this.documents.listDocumentChunks(documentId, parsed.data, requestIdentity(request));
  }

  @Get('ingestion-jobs')
  listJobs(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<IngestionJobListResponse> {
    const parsed = ingestionJobListRequestSchema.safeParse(query);
    if (!parsed.success) {
      throw new ApiException('INGESTION_JOB_LIST_QUERY_INVALID', '入库任务查询参数不合法', 400);
    }
    return this.documents.listJobs(parsed.data, requestIdentity(request));
  }

  @Get('ingestion-jobs/failed')
  getFailedJobs(@Req() request: FastifyRequest): Promise<object> {
    return this.documents.getFailedJobs(requestIdentity(request));
  }

  @Get('ingestion-jobs/:jobId')
  getJob(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
    @Req() request: FastifyRequest,
  ): Promise<IngestionJob> {
    return this.documents.getJob(jobId, requestIdentity(request));
  }

  @Post('ingestion-jobs/:jobId/retry')
  @HttpCode(202)
  retryJob(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
    @Req() request: FastifyRequest,
  ): Promise<IngestionRetryAccepted> {
    return this.documents.retryJob(jobId, requestIdentity(request), request.id);
  }

  @Delete('documents/:documentId')
  deleteDocument(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
  ): Promise<object> {
    return this.documents.deleteDocument(documentId, requestIdentity(request), request.id);
  }

  @Post('documents/:documentId/reindex')
  @HttpCode(202)
  reindexDocument(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Req() request: FastifyRequest,
  ): Promise<object> {
    return this.documents.reindexDocument(documentId, requestIdentity(request), request.id);
  }

  @Patch('documents/:documentId/metadata')
  @HttpCode(202)
  updateMetadata(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<object> {
    const parsed = documentMetadataUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiException('DOCUMENT_METADATA_INVALID', '文档 metadata 参数不合法', 400);
    }
    return this.documents.updateMetadata(
      documentId,
      parsed.data,
      requestIdentity(request),
      request.id,
    );
  }
}

export function parseSingleByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return undefined;
  const [, startText = '', endText = ''] = match;
  if (!startText && !endText) return undefined;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return undefined;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function inlineDisposition(sourceName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(sourceName)}`;
}
