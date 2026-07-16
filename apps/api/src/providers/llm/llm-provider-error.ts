import type { LlmProviderErrorKind } from './llm-provider';

const ERROR_CODES: Record<LlmProviderErrorKind, string> = {
  authentication: 'LLM_AUTHENTICATION_FAILED',
  rate_limit: 'LLM_RATE_LIMITED',
  timeout: 'LLM_TIMEOUT',
  invalid_request: 'LLM_INVALID_REQUEST',
  unavailable: 'LLM_UNAVAILABLE',
  invalid_response: 'LLM_INVALID_RESPONSE',
  not_configured: 'LLM_NOT_CONFIGURED',
  policy_denied: 'LLM_POLICY_DENIED',
};

const SAFE_MESSAGES: Record<LlmProviderErrorKind, string> = {
  authentication: 'LLM 服务认证失败',
  rate_limit: 'LLM 服务暂时繁忙，请稍后重试',
  timeout: 'LLM 服务请求超时',
  invalid_request: 'LLM 请求参数不合法',
  unavailable: 'LLM 服务暂时不可用',
  invalid_response: 'LLM 服务返回了不兼容的数据',
  not_configured: 'LLM Provider 尚未配置',
  policy_denied: '当前数据策略禁止调用 LLM 服务',
};

export class LlmProviderError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(
    readonly kind: LlmProviderErrorKind,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(SAFE_MESSAGES[kind], options);
    this.name = 'LlmProviderError';
    this.code = ERROR_CODES[kind];
    this.safeMessage = SAFE_MESSAGES[kind];
  }
}
