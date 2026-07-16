import { Injectable, Logger } from '@nestjs/common';

import type { EmbeddingTelemetryEvent } from './embedding-provider';

@Injectable()
export class EmbeddingTelemetry {
  private readonly logger = new Logger('EmbeddingProvider');

  record(event: EmbeddingTelemetryEvent): void {
    this.logger.log(event);
  }
}
