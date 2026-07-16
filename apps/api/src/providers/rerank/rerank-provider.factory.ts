import { Injectable } from '@nestjs/common';

import { AppConfig } from '../../config/app-config';
import { AlibabaRerankProvider } from './alibaba-rerank.provider';
import type { RerankProvider } from './rerank-provider';
import { RerankTelemetry } from './rerank-telemetry';

@Injectable()
export class RerankProviderFactory {
  private provider?: RerankProvider;

  constructor(
    private readonly config: AppConfig,
    private readonly telemetry: RerankTelemetry,
  ) {}

  getProvider(): RerankProvider | null {
    if (this.config.values.RERANK_PROVIDER === 'none') return null;
    this.provider ??= new AlibabaRerankProvider({
      apiKey: this.config.values.DASHSCOPE_API_KEY,
      baseUrl: this.config.values.RERANK_BASE_URL,
      model: this.config.values.RERANK_MODEL,
      region: this.config.values.RERANK_REGION,
      requestTimeoutMs: this.config.values.RERANK_REQUEST_TIMEOUT_MS,
      telemetryRecorder: (event) => this.telemetry.record(event),
    });
    return this.provider;
  }
}
