import { z } from 'zod';

import type {
  RerankProvider,
  RerankProviderErrorKind,
  RerankTelemetryEvent,
} from './rerank-provider';
import { RerankProviderError } from './rerank-provider-error';
import type { RetrievedChunk } from '../../knowledge/retrieved-chunk';

const responseSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    results: z.array(
      z.object({
        index: z.number().int().nonnegative(),
        relevance_score: z.number().min(0).max(1),
      }),
    ),
    usage: z.object({ total_tokens: z.number().int().nonnegative().optional() }).optional(),
  })
  .passthrough();

export interface AlibabaRerankOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  region: string;
  requestTimeoutMs: number;
  fetchFunction?: typeof fetch;
  nowFunction?: () => number;
  telemetryRecorder?: (event: RerankTelemetryEvent) => void;
}

export class AlibabaRerankProvider implements RerankProvider {
  readonly id = 'alibaba';
  readonly model: string;
  readonly region: string;

  private readonly endpoint: string;
  private readonly fetchFunction: typeof fetch;
  private readonly nowFunction: () => number;
  private readonly telemetryRecorder: (event: RerankTelemetryEvent) => void;

  constructor(private readonly options: AlibabaRerankOptions) {
    this.model = options.model;
    this.region = options.region;
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/reranks`;
    this.fetchFunction = options.fetchFunction ?? fetch;
    this.nowFunction = options.nowFunction ?? Date.now;
    this.telemetryRecorder = options.telemetryRecorder ?? (() => undefined);
  }

  async rerank(query: string, chunks: RetrievedChunk[], topK: number): Promise<RetrievedChunk[]> {
    if (!query.trim() || chunks.length === 0 || topK < 1 || topK > chunks.length) {
      throw new RerankProviderError('invalid_request', false);
    }
    const startedAt = this.nowFunction();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
    try {
      const response = await this.fetchFunction(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: chunks.map((chunk) => chunk.text),
          top_n: topK,
          instruct: 'Given a knowledge base question, retrieve passages that answer the question.',
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw this.mapStatus(response.status);
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch (error) {
        throw new RerankProviderError('invalid_response', false, { cause: error });
      }
      const parsed = responseSchema.safeParse(responseBody);
      if (
        !parsed.success ||
        parsed.data.results.length !== topK ||
        parsed.data.results.some((result) => result.index >= chunks.length) ||
        new Set(parsed.data.results.map((result) => result.index)).size !== topK
      ) {
        throw new RerankProviderError('invalid_response', false);
      }
      const reranked = parsed.data.results.map((result) => ({
        ...chunks[result.index]!,
        rerankScore: result.relevance_score,
      }));
      this.telemetryRecorder({
        provider: this.id,
        model: this.model,
        region: this.region,
        requestId: response.headers.get('x-request-id') ?? parsed.data.id,
        durationMs: this.nowFunction() - startedAt,
        inputCount: chunks.length,
        outputCount: reranked.length,
        totalTokens: parsed.data.usage?.total_tokens,
        status: 'success',
      });
      return reranked;
    } catch (error) {
      const normalized =
        error instanceof RerankProviderError
          ? error
          : controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
            ? new RerankProviderError('timeout', true, { cause: error })
            : new RerankProviderError('unavailable', true, { cause: error });
      this.recordFailure(startedAt, chunks.length, normalized.kind);
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapStatus(status: number): RerankProviderError {
    if ([400, 404, 422].includes(status)) return new RerankProviderError('invalid_request', false);
    if (status === 401 || status === 403) return new RerankProviderError('authentication', false);
    if (status === 429) return new RerankProviderError('rate_limit', true);
    if (status === 408) return new RerankProviderError('timeout', true);
    if ([500, 502, 503, 504].includes(status)) return new RerankProviderError('unavailable', true);
    return new RerankProviderError('unavailable', false);
  }

  private recordFailure(
    startedAt: number,
    inputCount: number,
    errorKind: RerankProviderErrorKind,
  ): void {
    this.telemetryRecorder({
      provider: this.id,
      model: this.model,
      region: this.region,
      durationMs: this.nowFunction() - startedAt,
      inputCount,
      status: 'error',
      errorKind,
    });
  }
}
