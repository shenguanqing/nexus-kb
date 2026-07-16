import type { ProviderErrorKind } from './embedding-provider';

const ERROR_CODES: Record<ProviderErrorKind, string> = {
  authentication: 'EMBEDDING_AUTHENTICATION_FAILED',
  rate_limit: 'EMBEDDING_RATE_LIMITED',
  timeout: 'EMBEDDING_TIMEOUT',
  invalid_request: 'EMBEDDING_INVALID_REQUEST',
  unavailable: 'EMBEDDING_UNAVAILABLE',
  invalid_response: 'EMBEDDING_INVALID_RESPONSE',
  not_configured: 'EMBEDDING_NOT_CONFIGURED',
  policy_denied: 'EMBEDDING_POLICY_DENIED',
};

const SAFE_MESSAGES: Record<ProviderErrorKind, string> = {
  authentication: 'Embedding 服务认证失败',
  rate_limit: 'Embedding 服务暂时繁忙，请稍后重试',
  timeout: 'Embedding 服务请求超时',
  invalid_request: 'Embedding 请求参数不合法',
  unavailable: 'Embedding 服务暂时不可用',
  invalid_response: 'Embedding 服务返回了不兼容的数据',
  not_configured: 'Embedding Provider 尚未配置',
  policy_denied: '当前数据策略禁止调用 Embedding 服务',
};

export class ProviderError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(
    readonly kind: ProviderErrorKind,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(SAFE_MESSAGES[kind], options);
    this.name = 'ProviderError';
    this.code = ERROR_CODES[kind];
    this.safeMessage = SAFE_MESSAGES[kind];
  }
}
