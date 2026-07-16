import { z } from 'zod';

import type {
  EmbeddingProvider,
  EmbeddingTelemetryEvent,
  EmbeddingTaskMode,
  ProviderErrorKind,
} from './embedding-provider';
import { ProviderError } from './provider-error';

const embeddingResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          embedding: z.array(z.number().finite()),
          index: z.number().int().nonnegative(),
        })
        .passthrough(),
    ),
    model: z.string().optional(),
    id: z.string().optional(),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type FetchFunction = typeof fetch;
type SleepFunction = (durationMs: number) => Promise<void>;
type TelemetryRecorder = (event: EmbeddingTelemetryEvent) => void;

export interface AlibabaEmbeddingOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  batchSize: number;
  region: string;
  requestTimeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  fetchFunction?: FetchFunction;
  sleepFunction?: SleepFunction;
  randomFunction?: () => number;
  nowFunction?: () => number;
  telemetryRecorder?: TelemetryRecorder;
}

export class AlibabaEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'alibaba';
  readonly taskMode: EmbeddingTaskMode = 'symmetric';
  readonly model: string;
  readonly dimensions: number;
  readonly region: string;

  private readonly endpoint: string;
  private readonly batchSize: number;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchFunction: FetchFunction;
  private readonly sleepFunction: SleepFunction;
  private readonly randomFunction: () => number;
  private readonly nowFunction: () => number;
  private readonly telemetryRecorder: TelemetryRecorder;
  private readonly apiKey: string;

  constructor(options: AlibabaEmbeddingOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.region = options.region;
    this.batchSize = options.batchSize;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.maxAttempts = options.maxAttempts;
    this.retryBaseDelayMs = options.retryBaseDelayMs;
    this.fetchFunction = options.fetchFunction ?? fetch;
    this.sleepFunction =
      options.sleepFunction ??
      ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    this.randomFunction = options.randomFunction ?? Math.random;
    this.nowFunction = options.nowFunction ?? Date.now;
    this.telemetryRecorder = options.telemetryRecorder ?? (() => undefined);
    this.apiKey = options.apiKey;
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.validateTexts(texts);
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      vectors.push(...(await this.embedBatch(batch, 'documents')));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    this.validateTexts([text]);
    const [vector] = await this.embedBatch([text], 'query');
    if (!vector) throw new ProviderError('invalid_response', false);
    return vector;
  }

  private async embedBatch(
    texts: string[],
    operation: EmbeddingTelemetryEvent['operation'],
  ): Promise<number[][]> {
    const startedAt = this.nowFunction();
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
      try {
        const response = await this.fetchFunction(this.endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            input: texts,
            dimensions: this.dimensions,
            encoding_format: 'float',
          }),
          signal: abortController.signal,
        });
        if (!response.ok) throw this.mapStatusError(response.status);
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch (error) {
          throw new ProviderError('invalid_response', false, { cause: error });
        }
        const parsed = embeddingResponseSchema.safeParse(responseBody);
        if (!parsed.success) throw new ProviderError('invalid_response', false);
        if (parsed.data.model && parsed.data.model !== this.model) {
          throw new ProviderError('invalid_response', false);
        }
        const orderedData = [...parsed.data.data].sort((left, right) => left.index - right.index);
        if (orderedData.some((item, index) => item.index !== index)) {
          throw new ProviderError('invalid_response', false);
        }
        const vectors = orderedData.map((item) => item.embedding);
        this.validateVectors(vectors, texts.length);
        this.telemetryRecorder({
          provider: this.id,
          model: this.model,
          region: this.region,
          operation,
          inputCount: texts.length,
          promptTokens: parsed.data.usage?.prompt_tokens,
          totalTokens: parsed.data.usage?.total_tokens,
          requestId: response.headers.get('x-request-id') ?? parsed.data.id,
          durationMs: this.nowFunction() - startedAt,
          attempts: attempt,
          status: 'success',
        });
        return vectors;
      } catch (error) {
        lastError = this.normalizeError(error, abortController.signal.aborted);
        if (!lastError.retryable || attempt === this.maxAttempts) {
          this.recordFailure(startedAt, attempt, texts.length, operation, lastError.kind);
          throw lastError;
        }
        await this.sleepFunction(this.retryDelay(attempt));
      } finally {
        clearTimeout(timeout);
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

  private mapStatusError(status: number): ProviderError {
    if ([400, 404, 422].includes(status)) return new ProviderError('invalid_request', false);
    if (status === 401 || status === 403) return new ProviderError('authentication', false);
    if (status === 429) return new ProviderError('rate_limit', true);
    if (status === 408) return new ProviderError('timeout', true);
    if ([500, 502, 503, 504].includes(status)) return new ProviderError('unavailable', true);
    return new ProviderError('unavailable', false);
  }

  private normalizeError(error: unknown, wasAborted: boolean): ProviderError {
    if (error instanceof ProviderError) return error;
    if (wasAborted || (error instanceof Error && error.name === 'AbortError')) {
      return new ProviderError('timeout', true, { cause: error });
    }
    return new ProviderError('unavailable', true, { cause: error });
  }

  private retryDelay(attempt: number): number {
    const exponential = this.retryBaseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.floor(this.randomFunction() * this.retryBaseDelayMs);
    return exponential + jitter;
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
