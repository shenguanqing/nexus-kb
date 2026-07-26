import { describe, expect, it } from 'vitest';

import { classifyIngestionError } from '../src/ingestion/ingestion-error';
import { ParserError } from '../src/parser/parser-error';
import { ProviderError } from '../src/providers/embedding/provider-error';
import { VectorStoreError } from '../src/vector-store/vector-store-error';

describe('ingestion error classification', () => {
  it('preserves adapter retry decisions', () => {
    expect(classifyIngestionError(new ParserError('timeout', true))).toEqual({
      code: 'PARSER_TIMEOUT',
      category: 'parser',
      retryable: true,
    });
    expect(
      classifyIngestionError(
        new ParserError('invalid_request', false, { code: 'CAD_ENTITY_LIMIT_EXCEEDED' }),
      ),
    ).toEqual({
      code: 'CAD_ENTITY_LIMIT_EXCEEDED',
      category: 'parser',
      retryable: false,
    });
    expect(classifyIngestionError(new ProviderError('authentication', false))).toEqual({
      code: 'EMBEDDING_AUTHENTICATION_FAILED',
      category: 'embedding',
      retryable: false,
    });
    expect(classifyIngestionError(new VectorStoreError('unavailable'))).toEqual({
      code: 'VECTOR_STORE_UNAVAILABLE',
      category: 'vector_store',
      retryable: true,
    });
    expect(classifyIngestionError(new VectorStoreError('configuration_mismatch'))).toEqual({
      code: 'VECTOR_STORE_CONFIGURATION_MISMATCH',
      category: 'vector_store',
      retryable: false,
    });
  });
});
