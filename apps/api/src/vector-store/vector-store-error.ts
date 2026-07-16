export type VectorStoreErrorKind =
  | 'not_configured'
  | 'configuration_mismatch'
  | 'invalid_input'
  | 'invalid_response'
  | 'unavailable';

const ERROR_CODES: Record<VectorStoreErrorKind, string> = {
  not_configured: 'VECTOR_STORE_NOT_CONFIGURED',
  configuration_mismatch: 'VECTOR_STORE_CONFIGURATION_MISMATCH',
  invalid_input: 'VECTOR_STORE_INVALID_INPUT',
  invalid_response: 'VECTOR_STORE_INVALID_RESPONSE',
  unavailable: 'VECTOR_STORE_UNAVAILABLE',
};

const SAFE_MESSAGES: Record<VectorStoreErrorKind, string> = {
  not_configured: '向量存储尚未配置',
  configuration_mismatch: '向量索引配置不兼容',
  invalid_input: '向量存储请求参数不合法',
  invalid_response: '向量存储返回了不兼容的数据',
  unavailable: '向量存储暂时不可用',
};

export class VectorStoreError extends Error {
  readonly code: string;
  readonly safeMessage: string;

  constructor(
    readonly kind: VectorStoreErrorKind,
    options?: { cause?: unknown },
  ) {
    super(ERROR_CODES[kind], options);
    this.name = 'VectorStoreError';
    this.code = ERROR_CODES[kind];
    this.safeMessage = SAFE_MESSAGES[kind];
  }
}
