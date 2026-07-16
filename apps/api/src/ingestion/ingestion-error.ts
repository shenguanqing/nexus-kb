import { ParserError } from '../parser/parser-error';
import { ProviderError } from '../providers/embedding/provider-error';
import { VectorStoreError } from '../vector-store/vector-store-error';

export interface IngestionErrorDetails {
  code: string;
  category: 'parser' | 'embedding' | 'vector_store' | 'processing';
  retryable: boolean;
}

export function classifyIngestionError(error: unknown): IngestionErrorDetails {
  if (error instanceof ParserError) {
    return { code: error.code, category: 'parser', retryable: error.retryable };
  }
  if (error instanceof ProviderError) {
    return { code: error.code, category: 'embedding', retryable: error.retryable };
  }
  if (error instanceof VectorStoreError) {
    return {
      code: error.code,
      category: 'vector_store',
      retryable: error.kind === 'unavailable',
    };
  }
  return { code: 'INGESTION_FAILED', category: 'processing', retryable: false };
}
