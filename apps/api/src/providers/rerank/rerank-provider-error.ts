import type { RerankProviderErrorKind } from './rerank-provider';

const ERROR_CODES: Record<RerankProviderErrorKind, string> = {
  authentication: 'RERANK_AUTHENTICATION_FAILED',
  rate_limit: 'RERANK_RATE_LIMITED',
  timeout: 'RERANK_TIMEOUT',
  invalid_request: 'RERANK_INVALID_REQUEST',
  unavailable: 'RERANK_UNAVAILABLE',
  invalid_response: 'RERANK_INVALID_RESPONSE',
  not_configured: 'RERANK_NOT_CONFIGURED',
  policy_denied: 'RERANK_POLICY_DENIED',
};

const SAFE_MESSAGES: Record<RerankProviderErrorKind, string> = {
  authentication: 'Rerank 服务认证失败',
  rate_limit: 'Rerank 服务暂时繁忙',
  timeout: 'Rerank 服务请求超时',
  invalid_request: 'Rerank 请求参数不合法',
  unavailable: 'Rerank 服务暂时不可用',
  invalid_response: 'Rerank 服务返回了不兼容的数据',
  not_configured: 'Rerank Provider 尚未配置',
  policy_denied: '当前数据策略禁止调用 Rerank 服务',
};

export class RerankProviderError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(
    readonly kind: RerankProviderErrorKind,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(SAFE_MESSAGES[kind], options);
    this.name = 'RerankProviderError';
    this.code = ERROR_CODES[kind];
    this.safeMessage = SAFE_MESSAGES[kind];
  }
}
