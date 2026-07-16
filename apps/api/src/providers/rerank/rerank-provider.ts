import type { RetrievedChunk } from '../../knowledge/retrieved-chunk';

export interface RerankProvider {
  readonly id: string;
  readonly model: string;
  readonly region: string;
  rerank(query: string, chunks: RetrievedChunk[], topK: number): Promise<RetrievedChunk[]>;
}

export type RerankProviderErrorKind =
  | 'authentication'
  | 'rate_limit'
  | 'timeout'
  | 'invalid_request'
  | 'unavailable'
  | 'invalid_response'
  | 'not_configured'
  | 'policy_denied';

export interface RerankTelemetryEvent {
  provider: string;
  model: string;
  region: string;
  requestId?: string;
  durationMs: number;
  inputCount: number;
  outputCount?: number;
  totalTokens?: number;
  status: 'success' | 'error';
  errorKind?: RerankProviderErrorKind;
}
