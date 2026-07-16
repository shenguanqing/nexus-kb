import { Injectable } from '@nestjs/common';
import pino, { type Logger } from 'pino';

import { AppConfig } from '../config/app-config';

export interface OperationalLogContext {
  traceId?: string;
  tenantId?: string;
  userId?: string;
  jobId?: string;
  documentId?: string;
  provider?: string;
  model?: string;
  status?: string;
  errorCode?: string;
  errorCategory?: string;
  checkpoint?: string;
  attempts?: number;
}

@Injectable()
export class OperationalLogger {
  private readonly logger: Logger;

  constructor(config: AppConfig) {
    this.logger = pino({
      level: config.values.LOG_LEVEL,
      base: { service: 'api' },
      redact: {
        paths: ['authorization', 'cookie', 'apiKey', 'token', 'password'],
        censor: '[REDACTED]',
      },
    });
  }

  info(event: string, context: OperationalLogContext): void {
    this.logger.info({ event, ...context }, event);
  }

  warn(event: string, context: OperationalLogContext): void {
    this.logger.warn({ event, ...context }, event);
  }

  error(event: string, context: OperationalLogContext): void {
    this.logger.error({ event, ...context }, event);
  }
}
