export type ParserErrorKind =
  'authentication' | 'invalid_request' | 'timeout' | 'unavailable' | 'invalid_response';

const ERROR_CODES: Record<ParserErrorKind, string> = {
  authentication: 'PARSER_AUTHENTICATION_FAILED',
  invalid_request: 'PARSER_INVALID_REQUEST',
  timeout: 'PARSER_TIMEOUT',
  unavailable: 'PARSER_UNAVAILABLE',
  invalid_response: 'PARSER_INVALID_RESPONSE',
};

export class ParserError extends Error {
  readonly code: string;

  constructor(
    readonly kind: ParserErrorKind,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(ERROR_CODES[kind], options);
    this.name = 'ParserError';
    this.code = ERROR_CODES[kind];
  }
}
