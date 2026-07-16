import { Module } from '@nestjs/common';

import { AppConfig } from './config/app-config';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { ParserClient } from './parser/parser-client';

@Module({
  controllers: [HealthController],
  providers: [AppConfig, HealthService, ParserClient],
})
export class AppModule {}
