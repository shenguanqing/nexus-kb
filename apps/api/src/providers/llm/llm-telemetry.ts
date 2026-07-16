import { Injectable, Logger } from '@nestjs/common';

import type { LlmTelemetryEvent } from './llm-provider';

@Injectable()
export class LlmTelemetry {
  private readonly logger = new Logger('LlmProvider');

  record(event: LlmTelemetryEvent): void {
    this.logger.log(event);
  }
}
