import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { IdentityService } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { DocumentsService } from './documents.service';

@Controller('v1')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly identities: IdentityService,
  ) {}

  @Post('documents')
  @HttpCode(202)
  async upload(@Req() request: FastifyRequest): Promise<object> {
    const file = await request.file();
    if (!file) throw new ApiException('FILE_REQUIRED', '必须上传一个文件', 400);
    return this.documents.upload(file, this.identities.current(), request.id);
  }

  @Get('documents/:documentId')
  getDocument(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
  ): Promise<object> {
    return this.documents.getDocument(documentId, this.identities.current());
  }

  @Get('ingestion-jobs/failed')
  getFailedJobs(): Promise<object> {
    return this.documents.getFailedJobs(this.identities.current());
  }

  @Get('ingestion-jobs/:jobId')
  getJob(@Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string): Promise<object> {
    return this.documents.getJob(jobId, this.identities.current());
  }

  @Delete('documents/:documentId')
  deleteDocument(
    @Param('documentId', new ParseUUIDPipe({ version: '4' })) documentId: string,
  ): Promise<object> {
    return this.documents.deleteDocument(documentId, this.identities.current());
  }
}
