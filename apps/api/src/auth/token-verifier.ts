import type { Identity } from './identity';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface TokenVerifier {
  verify(token: string): Promise<Identity>;
}

export class TokenVerificationError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Token verification failed', options);
    this.name = 'TokenVerificationError';
  }
}
