import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
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
  DocumentUploadOptions,
  IngestionJob,
  IngestionJobListResponse,
  IngestionRetryAccepted,
} from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

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
