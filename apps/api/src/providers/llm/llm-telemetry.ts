import { Injectable, Logger, Optional } from '@nestjs/common';

import type { LlmTelemetryEvent } from './llm-provider';
import { MetricsService } from '../../observability/metrics.service';
import { QueryProviderUsageContext } from '../../usage/query-provider-usage.context';

@Injectable()
export class LlmTelemetry {
  private readonly logger = new Logger('LlmProvider');

  constructor(
    private readonly metrics: MetricsService,
    @Optional() private readonly queryUsage?: QueryProviderUsageContext,
  ) {}

  record(event: LlmTelemetryEvent): void {
    this.logger.log(event);
    this.metrics.observeProvider('llm', event);
    this.queryUsage?.record('llm', event);
  }
}
