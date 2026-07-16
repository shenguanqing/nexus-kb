import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(200)
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.health.readiness();
    if (result.status !== 'ready') reply.status(503);
    return result;
  }
}
