import { Body, Controller, Post, Req } from '@nestjs/common';
import { knowledgeQueryRequestSchema } from '@nexus-kb/contracts';
import type { KnowledgeQueryResponse } from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

import { requestIdentity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { KnowledgeQueryService } from './knowledge-query.service';

@Controller('v1/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeQueryService) {}

  @Post('query')
  query(@Body() body: unknown, @Req() request: FastifyRequest): Promise<KnowledgeQueryResponse> {
    const parsed = knowledgeQueryRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiException('QUERY_INVALID', '问题格式不合法', 400);
    }
    return this.knowledge.query(parsed.data, requestIdentity(request), request.id);
  }
}
