import { createHash } from 'node:crypto';

import type { Environment } from '../../config/app-config';

export interface EmbeddingFingerprint {
  value: string;
  configuration: {
    schemaVersion: 1;
    provider: Exclude<Environment['EMBEDDING_PROVIDER'], 'none'>;
    model: string;
    dimensions: number;
    taskMode: Environment['EMBEDDING_TASK_MODE'];
    chunkMaxTokens: number;
    chunkOverlapTokens: number;
    redactionPolicyVersion: string;
  };
}

export function createEmbeddingFingerprint(environment: Environment): EmbeddingFingerprint {
  if (environment.EMBEDDING_PROVIDER === 'none') {
    throw new ProviderNotConfiguredFingerprintError();
  }
  const configuration = {
    schemaVersion: 1 as const,
    provider: environment.EMBEDDING_PROVIDER,
    model: environment.EMBEDDING_MODEL,
    dimensions: environment.EMBEDDING_DIMENSIONS,
    taskMode: environment.EMBEDDING_TASK_MODE,
    chunkMaxTokens: environment.CHUNK_MAX_TOKENS,
    chunkOverlapTokens: environment.CHUNK_OVERLAP_TOKENS,
    redactionPolicyVersion: environment.REDACTION_POLICY_VERSION,
  };
  return {
    value: createHash('sha256').update(JSON.stringify(configuration)).digest('hex'),
    configuration,
  };
}

class ProviderNotConfiguredFingerprintError extends Error {
  constructor() {
    super('Embedding fingerprint requires a configured provider');
    this.name = 'ProviderNotConfiguredFingerprintError';
  }
}
