import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ConversationDeleteResponse,
  ConversationDetail,
  ConversationListRequest,
  ConversationListResponse,
  ConversationTurn,
  KnowledgeQueryResponse,
} from '@nexus-kb/contracts';
import { knowledgeSourceSchema } from '@nexus-kb/contracts';

import type { Identity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../database/prisma.service';
import { SourceAuthorizationService } from '../knowledge/source-authorization.service';

type StoredQueryResponse = Omit<KnowledgeQueryResponse, 'conversationId'>;
const RECENT_CONTEXT_TURN_LIMIT = 4;
const HISTORICAL_SOURCE_UNAVAILABLE_TEXT = '该历史回答的可用来源已发生变化，请重新提问。';

@Injectable()
export class KnowledgeHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sourceAuthorization: SourceAuthorizationService,
  ) {}

  async recentQuestions(id: string, identity: Identity): Promise<string[]> {
    const row = await this.prisma.knowledgeConversation.findFirst({
      where: { id, tenantId: identity.tenantId, userId: identity.userId },
      select: {
        turns: {
          where: { questionSensitivity: identity.defaultSensitivity },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: RECENT_CONTEXT_TURN_LIMIT,
          select: { question: true },
        },
      },
    });
    if (!row) throw new ApiException('CONVERSATION_NOT_FOUND', '会话不存在', 404);
    return [...row.turns].reverse().map((turn) => turn.question);
  }

  async recordTurn(
    conversationId: string | undefined,
    question: string,
    response: StoredQueryResponse,
    identity: Identity,
  ): Promise<string> {
    const id = conversationId ?? randomUUID();
    await this.prisma.$transaction(async (transaction) => {
      if (conversationId) {
        const owned = await transaction.knowledgeConversation.findFirst({
          where: { id, tenantId: identity.tenantId, userId: identity.userId },
          select: { id: true },
        });
        if (!owned) throw new ApiException('CONVERSATION_NOT_FOUND', '会话不存在', 404);
      } else {
        await transaction.knowledgeConversation.create({
          data: {
            id,
            tenantId: identity.tenantId,
            userId: identity.userId,
            title: [...question].slice(0, 80).join(''),
          },
        });
      }
      await transaction.knowledgeTurn.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          question,
          questionSensitivity: identity.defaultSensitivity,
          answer: response.answer,
          noAnswer: response.noAnswer,
          reason: response.reason,
          answerMode: response.answerMode,
          traceId: response.traceId,
          sources: response.sources,
          model: response.model ?? undefined,
          rerankDegraded: response.rerankDegraded,
        },
      });
      await transaction.knowledgeConversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
    });
    return id;
  }

  async list(
    request: ConversationListRequest,
    identity: Identity,
  ): Promise<ConversationListResponse> {
    const where: Prisma.KnowledgeConversationWhereInput = {
      tenantId: identity.tenantId,
      userId: identity.userId,
      ...(request.query ? { title: { contains: request.query, mode: 'insensitive' } } : {}),
      ...((request.from || request.to) && {
        updatedAt: {
          ...(request.from ? { gte: new Date(request.from) } : {}),
          ...(request.to ? { lte: new Date(request.to) } : {}),
        },
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.knowledgeConversation.findMany({
        where,
        include: { _count: { select: { turns: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: request.offset,
        take: request.limit,
      }),
      this.prisma.knowledgeConversation.count({ where }),
    ]);
    return {
      conversations: rows.map((row) => ({
        id: row.id,
        title: row.title,
        messageCount: row._count.turns * 2,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      offset: request.offset,
      limit: request.limit,
    };
  }

  async detail(id: string, identity: Identity): Promise<ConversationDetail> {
    const row = await this.prisma.knowledgeConversation.findFirst({
      where: { id, tenantId: identity.tenantId, userId: identity.userId },
      include: { turns: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!row) throw new ApiException('CONVERSATION_NOT_FOUND', '会话不存在', 404);
    const turns = await Promise.all(
      row.turns.map(async (turn): Promise<ConversationTurn> => {
        const parsedSources = Array.isArray(turn.sources)
          ? turn.sources.map((source) => knowledgeSourceSchema.safeParse(source))
          : [];
        const storedSources = parsedSources.flatMap((result) =>
          result.success ? [result.data] : [],
        );
        const answerMode =
          turn.answerMode === 'grounded' || turn.answerMode === 'general'
            ? turn.answerMode
            : turn.noAnswer
              ? null
              : storedSources.length > 0
                ? 'grounded'
                : 'general';
        const sources =
          answerMode === 'grounded'
            ? await this.sourceAuthorization.retainActiveAuthorizedKnowledgeSources(
                identity,
                storedSources,
              )
            : [];
        const authorizationChanged =
          answerMode === 'grounded' &&
          (parsedSources.some((result) => !result.success) ||
            storedSources.length === 0 ||
            sources.length !== storedSources.length);
        return {
          id: turn.id,
          question: turn.question,
          answer: authorizationChanged ? HISTORICAL_SOURCE_UNAVAILABLE_TEXT : turn.answer,
          noAnswer: authorizationChanged || turn.noAnswer,
          reason: authorizationChanged
            ? ('authorization_changed' as const)
            : turn.reason === 'insufficient_relevance' || turn.reason === 'authorization_changed'
              ? turn.reason
              : null,
          answerMode: authorizationChanged ? null : answerMode,
          traceId: turn.traceId,
          sources: authorizationChanged ? [] : sources,
          sourceCount: authorizationChanged ? 0 : sources.length,
          createdAt: turn.createdAt.toISOString(),
        };
      }),
    );
    return {
      id: row.id,
      title: row.title,
      messageCount: row.turns.length * 2,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      turns,
    };
  }

  async delete(id: string, identity: Identity): Promise<ConversationDeleteResponse> {
    await this.prisma.knowledgeConversation.deleteMany({
      where: { id, tenantId: identity.tenantId, userId: identity.userId },
    });
    return { conversationId: id, deleted: true };
  }
}
