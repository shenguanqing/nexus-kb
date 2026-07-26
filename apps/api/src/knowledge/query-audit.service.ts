import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { Identity } from '../auth/identity';
import { PrismaService } from '../database/prisma.service';

export interface QueryAuditRecord {
  traceId: string;
  identity: Identity;
  queryLength: number;
  outcome: 'answered' | 'no_answer' | 'failed';
  answerMode?: 'grounded' | 'general';
  resultCount: number;
  sourceChunkIds: string[];
  embeddingProvider?: string;
  embeddingModel?: string;
  rerankProvider?: string;
  rerankModel?: string;
  rerankDegraded?: boolean;
  llmProvider?: string;
  llmModel?: string;
  fallbackUsed?: boolean;
  errorCode?: string;
  durationMs: number;
}

@Injectable()
export class QueryAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: QueryAuditRecord): Promise<void> {
    await this.prisma.queryAudit.create({
      data: {
        id: randomUUID(),
        traceId: input.traceId,
        tenantId: input.identity.tenantId,
        userId: input.identity.userId,
        department: input.identity.department,
        queryLength: input.queryLength,
        outcome: input.outcome,
        answerMode: input.answerMode,
        resultCount: input.resultCount,
        sourceChunkIds: input.sourceChunkIds,
        embeddingProvider: input.embeddingProvider,
        embeddingModel: input.embeddingModel,
        rerankProvider: input.rerankProvider,
        rerankModel: input.rerankModel,
        rerankDegraded: input.rerankDegraded ?? false,
        llmProvider: input.llmProvider,
        llmModel: input.llmModel,
        fallbackUsed: input.fallbackUsed ?? false,
        errorCode: input.errorCode,
        durationMs: input.durationMs,
      },
    });
  }
}
