import { Controller, Get, Req } from '@nestjs/common';
import type { AuthSession } from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

import { AppConfig } from '../config/app-config';
import { UserDirectoryService } from '../access/user-directory.service';
import { requestIdentity } from './identity';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly config: AppConfig,
    private readonly users: UserDirectoryService,
  ) {}

  @Get('session')
  async getSession(@Req() request: FastifyRequest): Promise<AuthSession> {
    const identity = requestIdentity(request);
    await this.users.observe(identity);
    return {
      authenticated: true,
      mode: this.config.values.AUTH_REQUIRED ? 'oidc' : 'development',
      identity: {
        ...identity,
        roles: [...identity.roles],
        allowedSensitivities: [...identity.allowedSensitivities],
        capabilities: [...identity.capabilities],
      },
    };
  }
}
