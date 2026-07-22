import { Controller, Get, Query, Req } from '@nestjs/common';
import { usageQueryRequestSchema } from '@nexus-kb/contracts';
import type { UsageResponse } from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

import { requestIdentity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { UsageService } from './usage.service';

@Controller('v1/system')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('usage')
  query(@Query() query: unknown, @Req() request: FastifyRequest): Promise<UsageResponse> {
    const parsed = usageQueryRequestSchema.safeParse(query);
    if (!parsed.success) throw new ApiException('USAGE_QUERY_INVALID', '用量查询参数不合法', 400);
    return this.usage.query(parsed.data, requestIdentity(request));
  }
}
