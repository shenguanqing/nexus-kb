import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AppConfig } from './config/app-config';
import { OperationalLogger } from './common/operational-logger';
import { AclPolicy } from './auth/acl-policy';
import { AuthenticationGuard } from './auth/authentication.guard';
import { OidcJwtTokenVerifier } from './auth/oidc-jwt-token.verifier';
import { TOKEN_VERIFIER } from './auth/token-verifier';
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
    OperationalLogger,
    HealthService,
    ParserClient,
    PrismaService,
    AclPolicy,
    OidcJwtTokenVerifier,
    { provide: TOKEN_VERIFIER, useExisting: OidcJwtTokenVerifier },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
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
