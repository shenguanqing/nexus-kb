import { Injectable, Logger } from '@nestjs/common';

import type { RerankTelemetryEvent } from './rerank-provider';
import { MetricsService } from '../../observability/metrics.service';

@Injectable()
export class RerankTelemetry {
  private readonly logger = new Logger('RerankProvider');

  constructor(private readonly metrics: MetricsService) {}

  record(event: RerankTelemetryEvent): void {
    this.logger.log(event);
    this.metrics.observeProvider('rerank', {
      ...event,
      inputTokens: event.totalTokens,
    });
  }
}
