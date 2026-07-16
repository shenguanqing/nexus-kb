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
import { AnswerSourceValidator } from './knowledge/answer-source-validator';
import { KnowledgeContextPolicy } from './knowledge/knowledge-context-policy';
import { LlmProviderFactory } from './providers/llm/llm-provider.factory';
import { LlmService } from './providers/llm/llm.service';
import { LlmTelemetry } from './providers/llm/llm-telemetry';
import { RerankProviderFactory } from './providers/rerank/rerank-provider.factory';
import { RerankService } from './providers/rerank/rerank.service';
import { RerankTelemetry } from './providers/rerank/rerank-telemetry';
import { SourceAuthorizationService } from './knowledge/source-authorization.service';

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
    AnswerSourceValidator,
    KnowledgeContextPolicy,
    SourceAuthorizationService,
    LlmTelemetry,
    LlmProviderFactory,
    LlmService,
    RerankTelemetry,
    RerankProviderFactory,
    RerankService,
    IngestionProcessor,
    IngestionQueue,
    DocumentsService,
  ],
})
export class AppModule {}
