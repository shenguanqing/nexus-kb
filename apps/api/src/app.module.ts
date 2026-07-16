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
import { ChunkingService } from './ingestion/chunking';
import { CloudPolicyService } from './ingestion/cloud-policy';
import { RedactionService } from './ingestion/redaction';
import { EmbeddingProviderFactory } from './providers/embedding/embedding-provider.factory';
import { EmbeddingService } from './providers/embedding/embedding.service';
import { EmbeddingTelemetry } from './providers/embedding/embedding-telemetry';

@Module({
  controllers: [HealthController, DocumentsController],
  providers: [
    AppConfig,
    HealthService,
    ParserClient,
    PrismaService,
    IdentityService,
    ChunkingService,
    RedactionService,
    CloudPolicyService,
    EmbeddingTelemetry,
    EmbeddingProviderFactory,
    EmbeddingService,
    IngestionQueue,
    DocumentsService,
  ],
})
export class AppModule {}
