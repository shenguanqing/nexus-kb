import { Injectable, Logger, Optional } from '@nestjs/common';

import type { RerankTelemetryEvent } from './rerank-provider';
import { MetricsService } from '../../observability/metrics.service';
import { QueryProviderUsageContext } from '../../usage/query-provider-usage.context';

@Injectable()
export class RerankTelemetry {
  private readonly logger = new Logger('RerankProvider');

  constructor(
    private readonly metrics: MetricsService,
    @Optional() private readonly queryUsage?: QueryProviderUsageContext,
  ) {}

  record(event: RerankTelemetryEvent): void {
    this.logger.log(event);
    this.metrics.observeProvider('rerank', {
      ...event,
      inputTokens: event.totalTokens,
    });
    this.queryUsage?.record('rerank', {
      ...event,
      inputTokens: event.totalTokens,
    });
  }
}
