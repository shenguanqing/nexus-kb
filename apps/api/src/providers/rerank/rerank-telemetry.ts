import { Injectable, Logger } from '@nestjs/common';

import type { RerankTelemetryEvent } from './rerank-provider';

@Injectable()
export class RerankTelemetry {
  private readonly logger = new Logger('RerankProvider');

  record(event: RerankTelemetryEvent): void {
    this.logger.log(event);
  }
}
