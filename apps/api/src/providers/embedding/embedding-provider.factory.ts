import { Injectable } from '@nestjs/common';

import { AppConfig } from '../../config/app-config';
import { AlibabaEmbeddingProvider } from './alibaba-embedding.provider';
import { createEmbeddingFingerprint } from './embedding-fingerprint';
import type { EmbeddingFingerprint } from './embedding-fingerprint';
import type { EmbeddingProvider } from './embedding-provider';
import { EmbeddingTelemetry } from './embedding-telemetry';
import { GoogleEmbeddingProvider } from './google-embedding.provider';
import { OllamaEmbeddingProvider } from './ollama-embedding.provider';
import { ProviderError } from './provider-error';

@Injectable()
export class EmbeddingProviderFactory {
  private provider?: EmbeddingProvider;

  constructor(
    private readonly config: AppConfig,
    private readonly telemetry: EmbeddingTelemetry,
  ) {}

  getProvider(): EmbeddingProvider {
    if (this.config.values.EMBEDDING_PROVIDER === 'none') {
      throw new ProviderError('not_configured', false);
    }
    this.provider ??=
      this.config.values.EMBEDDING_PROVIDER === 'ollama'
        ? new OllamaEmbeddingProvider({
            baseUrl: this.config.values.OLLAMA_BASE_URL,
            model: this.config.values.EMBEDDING_MODEL,
            dimensions: this.config.values.EMBEDDING_DIMENSIONS,
            batchSize: this.config.values.EMBEDDING_BATCH_SIZE,
            region: this.config.values.EMBEDDING_REGION,
            requestTimeoutMs: this.config.values.EMBEDDING_REQUEST_TIMEOUT_MS,
            maxAttempts: this.config.values.EMBEDDING_MAX_ATTEMPTS,
            retryBaseDelayMs: this.config.values.EMBEDDING_RETRY_BASE_DELAY_MS,
            keepAlive: this.config.values.OLLAMA_KEEP_ALIVE,
            telemetryRecorder: (event) => this.telemetry.record(event),
          })
        : this.config.values.EMBEDDING_PROVIDER === 'google'
          ? new GoogleEmbeddingProvider({
              apiKey: this.config.values.GEMINI_API_KEY,
              baseUrl: this.config.values.GEMINI_BASE_URL,
              model: this.config.values.EMBEDDING_MODEL,
              dimensions: this.config.values.EMBEDDING_DIMENSIONS,
              batchSize: this.config.values.EMBEDDING_BATCH_SIZE,
              region: this.config.values.EMBEDDING_REGION,
              requestTimeoutMs: this.config.values.EMBEDDING_REQUEST_TIMEOUT_MS,
              maxAttempts: this.config.values.EMBEDDING_MAX_ATTEMPTS,
              retryBaseDelayMs: this.config.values.EMBEDDING_RETRY_BASE_DELAY_MS,
              telemetryRecorder: (event) => this.telemetry.record(event),
            })
          : new AlibabaEmbeddingProvider({
              apiKey: this.config.values.DASHSCOPE_API_KEY,
              baseUrl: this.config.values.ALIBABA_BASE_URL,
              model: this.config.values.EMBEDDING_MODEL,
              dimensions: this.config.values.EMBEDDING_DIMENSIONS,
              batchSize: this.config.values.EMBEDDING_BATCH_SIZE,
              region: this.config.values.EMBEDDING_REGION,
              requestTimeoutMs: this.config.values.EMBEDDING_REQUEST_TIMEOUT_MS,
              maxAttempts: this.config.values.EMBEDDING_MAX_ATTEMPTS,
              retryBaseDelayMs: this.config.values.EMBEDDING_RETRY_BASE_DELAY_MS,
              telemetryRecorder: (event) => this.telemetry.record(event),
            });
    return this.provider;
  }

  getFingerprint(): EmbeddingFingerprint {
    return createEmbeddingFingerprint(this.config.values);
  }
}
