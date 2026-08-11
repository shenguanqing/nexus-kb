import { Injectable, Logger, Optional } from '@nestjs/common';

import type { EmbeddingTelemetryEvent } from './embedding-provider';
import { MetricsService } from '../../observability/metrics.service';
import { QueryProviderUsageContext } from '../../usage/query-provider-usage.context';

@Injectable()
export class EmbeddingTelemetry {
  private readonly logger = new Logger('EmbeddingProvider');

  constructor(
    private readonly metrics: MetricsService,
    @Optional() private readonly queryUsage?: QueryProviderUsageContext,
  ) {}

  record(event: EmbeddingTelemetryEvent): void {
    this.logger.log(event);
    this.metrics.observeProvider('embedding', {
      ...event,
      inputTokens: event.promptTokens,
    });
    this.queryUsage?.record('embedding', {
      ...event,
      inputTokens: event.promptTokens,
    });
  }
}
