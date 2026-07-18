import { Controller, Get, Req } from '@nestjs/common';
import type { AuthSession } from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

import { AppConfig } from '../config/app-config';
import { requestIdentity } from './identity';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly config: AppConfig) {}

  @Get('session')
  getSession(@Req() request: FastifyRequest): AuthSession {
    const identity = requestIdentity(request);
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
