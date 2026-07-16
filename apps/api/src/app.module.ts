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
import { IngestionProcessor } from './ingestion/ingestion.processor';
import { EmbeddingProviderFactory } from './providers/embedding/embedding-provider.factory';
import { EmbeddingService } from './providers/embedding/embedding.service';
import { EmbeddingTelemetry } from './providers/embedding/embedding-telemetry';
import { ChromaVectorStore } from './vector-store/chroma-vector-store';

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
    ChromaVectorStore,
    IngestionProcessor,
    IngestionQueue,
    DocumentsService,
  ],
})
export class AppModule {}
