import { Module } from '@nestjs/common';

import { AppConfig } from './config/app-config';
import { IdentityService } from './auth/identity';
import { PrismaService } from './database/prisma.service';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { ParserClient } from './parser/parser-client';
import { IngestionQueue } from './ingestion/ingestion.queue';

@Module({
  controllers: [HealthController, DocumentsController],
  providers: [
    AppConfig,
    HealthService,
    ParserClient,
    PrismaService,
    IdentityService,
    IngestionQueue,
    DocumentsService,
  ],
})
export class AppModule {}
