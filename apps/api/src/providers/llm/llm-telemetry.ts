import { Injectable, Logger } from '@nestjs/common';

import type { LlmTelemetryEvent } from './llm-provider';
import { MetricsService } from '../../observability/metrics.service';

@Injectable()
export class LlmTelemetry {
  private readonly logger = new Logger('LlmProvider');

  constructor(private readonly metrics: MetricsService) {}

  record(event: LlmTelemetryEvent): void {
    this.logger.log(event);
    this.metrics.observeProvider('llm', event);
  }
}
