import { Controller, Delete, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { conversationListRequestSchema } from '@nexus-kb/contracts';
import type {
  ConversationDeleteResponse,
  ConversationDetail,
  ConversationListResponse,
} from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

import { requestIdentity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { KnowledgeHistoryService } from './knowledge-history.service';

@Controller('v1/history/conversations')
export class HistoryController {
  constructor(private readonly history: KnowledgeHistoryService) {}

  @Get()
  list(@Query() query: unknown, @Req() request: FastifyRequest): Promise<ConversationListResponse> {
    const parsed = conversationListRequestSchema.safeParse(query);
    if (!parsed.success) throw new ApiException('HISTORY_QUERY_INVALID', '历史查询参数不合法', 400);
    return this.history.list(parsed.data, requestIdentity(request));
  }

  @Get(':conversationId')
  detail(
    @Param('conversationId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: FastifyRequest,
  ): Promise<ConversationDetail> {
    return this.history.detail(id, requestIdentity(request));
  }

  @Delete(':conversationId')
  delete(
    @Param('conversationId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: FastifyRequest,
  ): Promise<ConversationDeleteResponse> {
    return this.history.delete(id, requestIdentity(request));
  }
}
