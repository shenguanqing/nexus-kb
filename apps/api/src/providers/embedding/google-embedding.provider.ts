import { ApiError, GoogleGenAI } from '@google/genai';
import type { EmbedContentParameters, EmbedContentResponse } from '@google/genai';

import type {
  EmbeddingProvider,
  EmbeddingTelemetryEvent,
  ProviderErrorKind,
} from './embedding-provider';
import { ProviderError } from './provider-error';

type SleepFunction = (durationMs: number) => Promise<void>;
type TelemetryRecorder = (event: EmbeddingTelemetryEvent) => void;

interface GoogleEmbeddingClient {
  models: {
    embedContent(parameters: EmbedContentParameters): Promise<EmbedContentResponse>;
  };
}

export interface GoogleEmbeddingOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  batchSize: number;
  region: string;
  requestTimeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  client?: GoogleEmbeddingClient;
  sleepFunction?: SleepFunction;
  randomFunction?: () => number;
  nowFunction?: () => number;
  telemetryRecorder?: TelemetryRecorder;
}

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'google';
  readonly taskMode = 'retrieval_document_query' as const;
  readonly documentTaskRule = 'RETRIEVAL_DOCUMENT';
  readonly queryTaskRule = 'RETRIEVAL_QUERY';
  readonly model: string;
  readonly dimensions: number;
  readonly region: string;

  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly client: GoogleEmbeddingClient;
  private readonly sleepFunction: SleepFunction;
  private readonly randomFunction: () => number;
  private readonly nowFunction: () => number;
  private readonly telemetryRecorder: TelemetryRecorder;

  constructor(options: GoogleEmbeddingOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.region = options.region;
    this.batchSize = options.batchSize;
    this.maxAttempts = options.maxAttempts;
    this.retryBaseDelayMs = options.retryBaseDelayMs;
    this.sleepFunction =
      options.sleepFunction ??
      ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    this.randomFunction = options.randomFunction ?? Math.random;
    this.nowFunction = options.nowFunction ?? Date.now;
    this.telemetryRecorder = options.telemetryRecorder ?? (() => undefined);
    const endpoint = googleSdkEndpoint(options.baseUrl);
    this.client =
      options.client ??
      new GoogleGenAI({
        apiKey: options.apiKey,
        apiVersion: endpoint.apiVersion,
        httpOptions: {
          baseUrl: endpoint.baseUrl,
          timeout: options.requestTimeoutMs,
          retryOptions: { attempts: 1 },
        },
      });
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.validateTexts(texts);
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      vectors.push(
        ...(await this.embedBatch(
          texts.slice(offset, offset + this.batchSize),
          'documents',
          this.documentTaskRule,
        )),
      );
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    this.validateTexts([text]);
    const [vector] = await this.embedBatch([text], 'query', this.queryTaskRule);
    if (!vector) throw new ProviderError('invalid_response', false);
    return vector;
  }

  private async embedBatch(
    texts: string[],
    operation: EmbeddingTelemetryEvent['operation'],
    taskType: string,
  ): Promise<number[][]> {
    const startedAt = this.nowFunction();
    let lastError: ProviderError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await this.client.models.embedContent({
          model: this.model,
          contents: texts,
          config: { taskType, outputDimensionality: this.dimensions },
        });
        const vectors = (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
        this.validateVectors(vectors, texts.length);
        const normalized =
          this.dimensions === 3072 ? vectors : vectors.map((vector) => normalizeVector(vector));
        this.telemetryRecorder({
          provider: this.id,
          model: this.model,
          region: this.region,
          operation,
          inputCount: texts.length,
          requestId: response.sdkHttpResponse?.headers?.['x-request-id'],
          durationMs: this.nowFunction() - startedAt,
          attempts: attempt,
          status: 'success',
        });
        return normalized;
      } catch (error) {
        lastError = this.normalizeError(error);
        if (!lastError.retryable || attempt === this.maxAttempts) {
          this.recordFailure(startedAt, attempt, texts.length, operation, lastError.kind);
          throw lastError;
        }
        await this.sleepFunction(this.retryDelay(attempt));
      }
    }
    const exhausted = lastError ?? new ProviderError('unavailable', false);
    this.recordFailure(startedAt, this.maxAttempts, texts.length, operation, exhausted.kind);
    throw exhausted;
  }

  private validateTexts(texts: string[]): void {
    if (texts.length === 0 || texts.some((text) => !text.trim())) {
      throw new ProviderError('invalid_request', false);
    }
  }

  private validateVectors(vectors: number[][], inputCount: number): void {
    if (
      vectors.length !== inputCount ||
      vectors.some(
        (vector) =>
          vector.length !== this.dimensions || vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new ProviderError('invalid_response', false);
    }
  }

  private normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError) return error;
    const status = error instanceof ApiError ? error.status : undefined;
    if ([400, 404, 422].includes(status ?? 0)) return new ProviderError('invalid_request', false);
    if (status === 401 || status === 403) return new ProviderError('authentication', false);
    if (status === 429) return new ProviderError('rate_limit', true);
    if (status === 408) return new ProviderError('timeout', true);
    if ([500, 502, 503, 504].includes(status ?? 0)) {
      return new ProviderError('unavailable', true);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return new ProviderError('timeout', true, { cause: error });
    }
    return new ProviderError('unavailable', true, { cause: error });
  }

  private retryDelay(attempt: number): number {
    return (
      this.retryBaseDelayMs * 2 ** (attempt - 1) +
      Math.floor(this.randomFunction() * this.retryBaseDelayMs)
    );
  }

  private recordFailure(
    startedAt: number,
    attempts: number,
    inputCount: number,
    operation: EmbeddingTelemetryEvent['operation'],
    errorKind: ProviderErrorKind,
  ): void {
    this.telemetryRecorder({
      provider: this.id,
      model: this.model,
      region: this.region,
      operation,
      inputCount,
      durationMs: this.nowFunction() - startedAt,
      attempts,
      status: 'error',
      errorKind,
    });
  }
}

function googleSdkEndpoint(baseUrl: string): { baseUrl: string; apiVersion: string } {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, '');
  const apiVersion = path.slice(1);
  return { baseUrl: `${url.origin}/`, apiVersion };
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new ProviderError('invalid_response', false);
  }
  return vector.map((value) => value / magnitude);
}
