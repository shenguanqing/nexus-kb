import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  departmentPolicyUpdateRequestSchema,
  managedUserCreateRequestSchema,
  managedUserUpdateRequestSchema,
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

  @Post('users')
  createUser(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = managedUserCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiException('USER_ACCOUNT_CREATE_INVALID', '新建账号参数不合法', 400);
    }
    return this.users.createManagedUser(parsed.data, requestIdentity(request), request.id);
  }

  @Patch('users/:userId')
  updateUser(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const parsed = managedUserUpdateRequestSchema.safeParse(body);
    if (!parsed.success || userId.length < 1 || userId.length > 256) {
      throw new ApiException('USER_ACCOUNT_UPDATE_INVALID', '账号更新参数不合法', 400);
    }
    return this.users.updateManagedUser(userId, parsed.data, requestIdentity(request), request.id);
  }

  @Delete('users/:userId')
  @HttpCode(200)
  deleteUser(@Param('userId') userId: string, @Req() request: FastifyRequest) {
    if (userId.length < 1 || userId.length > 256) {
      throw new ApiException('USER_ACCOUNT_DELETE_INVALID', '账号删除参数不合法', 400);
    }
    return this.users.deleteManagedUser(userId, requestIdentity(request), request.id);
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
