import { Controller, Get, Query, Req } from '@nestjs/common';
import { userDirectoryQueryRequestSchema } from '@nexus-kb/contracts';
import type { UserDirectoryQueryResponse } from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

import { requestIdentity } from '../auth/identity';
import { ApiException } from '../common/api-exception';
import { UserDirectoryService } from './user-directory.service';

@Controller('v1/access')
export class AccessController {
  constructor(private readonly users: UserDirectoryService) {}

  @Get('users')
  queryUsers(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<UserDirectoryQueryResponse> {
    const parsed = userDirectoryQueryRequestSchema.safeParse(query);
    if (!parsed.success) {
      throw new ApiException('USER_DIRECTORY_QUERY_INVALID', '用户查询参数不合法', 400);
    }
    return this.users.query(parsed.data, requestIdentity(request));
  }
}
