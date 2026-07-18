import { Controller, Get, Req } from '@nestjs/common';
import type { ProviderStatusResponse, SystemStatusResponse } from '@nexus-kb/contracts';
import type { FastifyRequest } from 'fastify';

import { requestIdentity } from '../auth/identity';
import { SystemService } from './system.service';

@Controller('v1/system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('providers')
  providers(@Req() request: FastifyRequest): ProviderStatusResponse {
    return this.system.providers(requestIdentity(request));
  }

  @Get('status')
  status(@Req() request: FastifyRequest): Promise<SystemStatusResponse> {
    return this.system.status(requestIdentity(request));
  }
}
