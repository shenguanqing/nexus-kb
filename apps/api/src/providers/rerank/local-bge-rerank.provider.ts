import { localRerankResponseSchema } from '@nexus-kb/contracts';

import type {
  RerankProvider,
  RerankProviderErrorKind,
  RerankTelemetryEvent,
} from './rerank-provider';
import { RerankProviderError } from './rerank-provider-error';
import type { RetrievedChunk } from '../../knowledge/retrieved-chunk';

export interface LocalBgeRerankOptions {
  internalToken: string;
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
  fetchFunction?: typeof fetch;
  nowFunction?: () => number;
  telemetryRecorder?: (event: RerankTelemetryEvent) => void;
}

export class LocalBgeRerankProvider implements RerankProvider {
  readonly id = 'local_bge';
  readonly region = 'local';
  readonly model: string;

  private readonly endpoint: string;
  private readonly fetchFunction: typeof fetch;
  private readonly nowFunction: () => number;
  private readonly telemetryRecorder: (event: RerankTelemetryEvent) => void;

  constructor(private readonly options: LocalBgeRerankOptions) {
    this.model = options.model;
    this.endpoint = new URL('/internal/v1/rerank', options.baseUrl).toString();
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
          'content-type': 'application/json',
          'x-rerank-internal-token': this.options.internalToken,
        },
        body: JSON.stringify({ query, documents: chunks.map((chunk) => chunk.text), topK }),
        signal: controller.signal,
      });
      if (!response.ok) throw this.mapStatus(response.status);
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw new RerankProviderError('timeout', true, { cause: error });
        }
        throw new RerankProviderError('invalid_response', false, { cause: error });
      }
      const parsed = localRerankResponseSchema.safeParse(responseBody);
      if (
        !parsed.success ||
        parsed.data.model !== this.model ||
        parsed.data.results.length !== topK ||
        parsed.data.results.some((result) => result.index >= chunks.length) ||
        new Set(parsed.data.results.map((result) => result.index)).size !== topK
      ) {
        throw new RerankProviderError('invalid_response', false);
      }
      const reranked = parsed.data.results.map((result) => ({
        ...chunks[result.index]!,
        rerankScore: result.relevanceScore,
      }));
      this.telemetryRecorder({
        provider: this.id,
        model: this.model,
        region: this.region,
        durationMs: this.nowFunction() - startedAt,
        inputCount: chunks.length,
        outputCount: reranked.length,
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
    if (status === 401 || status === 403) return new RerankProviderError('authentication', false);
    if (status === 429) return new RerankProviderError('rate_limit', true);
    if (status === 408) return new RerankProviderError('timeout', true);
    if ([400, 404, 422].includes(status)) return new RerankProviderError('invalid_request', false);
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
