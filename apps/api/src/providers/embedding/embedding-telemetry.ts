import { Injectable, Logger } from '@nestjs/common';

import type { EmbeddingTelemetryEvent } from './embedding-provider';
import { MetricsService } from '../../observability/metrics.service';

@Injectable()
export class EmbeddingTelemetry {
  private readonly logger = new Logger('EmbeddingProvider');

  constructor(private readonly metrics: MetricsService) {}

  record(event: EmbeddingTelemetryEvent): void {
    this.logger.log(event);
    this.metrics.observeProvider('embedding', {
      ...event,
      inputTokens: event.promptTokens,
    });
  }
}
