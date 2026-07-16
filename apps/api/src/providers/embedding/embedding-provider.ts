export type EmbeddingTaskMode = 'symmetric';

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  readonly region: string;
  readonly taskMode: EmbeddingTaskMode;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export interface EmbeddingTelemetryEvent {
  provider: string;
  model: string;
  region: string;
  operation: 'documents' | 'query';
  inputCount: number;
  promptTokens?: number;
  totalTokens?: number;
  requestId?: string;
  durationMs: number;
  attempts: number;
  status: 'success' | 'error';
  errorKind?: ProviderErrorKind;
}

export type ProviderErrorKind =
  | 'authentication'
  | 'rate_limit'
  | 'timeout'
  | 'invalid_request'
  | 'unavailable'
  | 'invalid_response'
  | 'not_configured'
  | 'policy_denied';
