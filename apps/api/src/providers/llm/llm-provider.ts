import type { RetrievedChunk } from '../../knowledge/retrieved-chunk';

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LlmAnswerInput {
  question: string;
  contexts: RetrievedChunk[];
  traceId: string;
  citationRepair?: true;
}

export interface LlmAnswer {
  text: string;
  usage?: ModelUsage;
  requestId?: string;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly region: string;
  answer(input: LlmAnswerInput): Promise<LlmAnswer>;
}

export type LlmProviderErrorKind =
  | 'authentication'
  | 'rate_limit'
  | 'timeout'
  | 'invalid_request'
  | 'unavailable'
  | 'invalid_response'
  | 'not_configured'
  | 'policy_denied';

export interface LlmTelemetryEvent {
  provider: string;
  model: string;
  region: string;
  requestId?: string;
  durationMs: number;
  attempts: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextCount: number;
  status: 'success' | 'error';
  errorKind?: LlmProviderErrorKind;
}
