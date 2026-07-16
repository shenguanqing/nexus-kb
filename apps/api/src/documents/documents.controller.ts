import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { requestIdentity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { DocumentsService } from './documents.service';

@Controller('v1')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

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
    return this.documents.deleteDocument(documentId, requestIdentity(request));
  }
}
