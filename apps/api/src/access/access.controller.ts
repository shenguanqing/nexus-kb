import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import {
  departmentPolicyUpdateRequestSchema,
  userDirectoryQueryRequestSchema,
  userRoleUpdateRequestSchema,
} from '@nexus-kb/contracts';
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

  @Patch('users/:userId/roles')
  updateRoles(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const parsed = userRoleUpdateRequestSchema.safeParse(body);
    if (!parsed.success || userId.length < 1 || userId.length > 256) {
      throw new ApiException('USER_ROLE_UPDATE_INVALID', '角色修改参数不合法', 400);
    }
    return this.users.updateRoles(userId, parsed.data, requestIdentity(request), request.id);
  }

  @Get('departments')
  listDepartments(@Req() request: FastifyRequest) {
    return this.users.listDepartments(requestIdentity(request));
  }

  @Patch('departments/:department')
  updateDepartment(
    @Param('department') department: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const parsed = departmentPolicyUpdateRequestSchema.safeParse(body);
    if (!parsed.success || department.length < 1 || department.length > 128) {
      throw new ApiException('DEPARTMENT_POLICY_UPDATE_INVALID', '部门策略参数不合法', 400);
    }
    return this.users.updateDepartment(
      department,
      parsed.data,
      requestIdentity(request),
      request.id,
    );
  }
}
