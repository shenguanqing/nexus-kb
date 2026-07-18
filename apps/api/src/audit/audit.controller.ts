import { Controller, Get, Query, Req } from '@nestjs/common';
import { auditQueryRequestSchema } from '@nexus-kb/contracts';
import type { AuditQueryResponse } from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

import { requestIdentity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { AuditService } from './audit.service';

@Controller('v1/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  query(@Query() query: unknown, @Req() request: FastifyRequest): Promise<AuditQueryResponse> {
    const parsed = auditQueryRequestSchema.safeParse(query);
    if (!parsed.success) throw new ApiException('AUDIT_QUERY_INVALID', '审计查询参数不合法', 400);
    return this.audit.query(parsed.data, requestIdentity(request));
  }
}
