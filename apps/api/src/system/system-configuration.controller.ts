import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  deploymentAgentResultSchema,
  systemConfigurationUpdateRequestSchema,
} from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requestIdentity } from '../auth/identity';
import { Public } from '../auth/public.decorator';
import { ApiException } from '../common/api-exception';
import { SystemConfigurationService } from './system-configuration.service';

const resourceIdSchema = z.uuid();

function resourceId(value: string): string {
  const parsed = resourceIdSchema.safeParse(value);
  if (!parsed.success) throw new ApiException('SYSTEM_RESOURCE_ID_INVALID', '资源 ID 不合法', 400);
  return parsed.data;
}

@Controller('v1/system')
export class SystemConfigurationController {
  constructor(private readonly configurations: SystemConfigurationService) {}

  @Get('configuration')
  configuration(@Req() request: FastifyRequest) {
    return this.configurations.configuration(requestIdentity(request));
  }

  @Post('configurations')
  createVersion(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = systemConfigurationUpdateRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiException('SYSTEM_CONFIG_INVALID', '配置参数不合法', 400);
    return this.configurations.createVersion(parsed.data, requestIdentity(request), request.id);
  }

  @Post('configurations/:id/deploy')
  @HttpCode(202)
  async deploy(@Param('id') id: string, @Req() request: FastifyRequest) {
    return {
      deployment: await this.configurations.deployVersion(
        resourceId(id),
        requestIdentity(request),
        request.id,
      ),
    };
  }

  @Get('deployments')
  deployments(@Req() request: FastifyRequest) {
    return this.configurations.listDeployments(requestIdentity(request));
  }

  @Get('deployments/:id')
  deployment(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.configurations.deployment(resourceId(id), requestIdentity(request));
  }

  @Post('deployments/:id/rollback')
  @HttpCode(202)
  async rollback(@Param('id') id: string, @Req() request: FastifyRequest) {
    return {
      deployment: await this.configurations.rollback(
        resourceId(id),
        requestIdentity(request),
        request.id,
      ),
    };
  }
}

@Public()
@Controller('v1/internal/deployments')
export class DeploymentAgentCallbackController {
  constructor(private readonly configurations: SystemConfigurationService) {}

  @Post(':id/result')
  result(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.configurations.authenticateAgent(authorization?.replace(/^Bearer /, ''));
    const parsed = deploymentAgentResultSchema.safeParse(body);
    if (!parsed.success) throw new ApiException('DEPLOYMENT_RESULT_INVALID', '发布结果不合法', 400);
    return this.configurations.completeFromAgent(resourceId(id), parsed.data);
  }
}
