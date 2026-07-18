import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { documentListRequestSchema } from '@nexus-kb/contracts';
import type { DocumentListResponse, DocumentUploadOptions } from '@nexus-kb/contracts';
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
  ): Promise<object> {
    return this.documents.getDocument(documentId, requestIdentity(request));
  }

  @Get('ingestion-jobs/failed')
  getFailedJobs(@Req() request: FastifyRequest): Promise<object> {
    return this.documents.getFailedJobs(requestIdentity(request));
  }

  @Get('ingestion-jobs/:jobId')
  getJob(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
    @Req() request: FastifyRequest,
  ): Promise<object> {
    return this.documents.getJob(jobId, requestIdentity(request));
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
}
