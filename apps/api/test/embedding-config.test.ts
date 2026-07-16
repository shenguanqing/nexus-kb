import { describe, expect, it } from 'vitest';

import { parseEnvironment } from '../src/config/app-config';

const baseEnvironment = {
  DATABASE_URL: 'postgresql://kb:kb@postgres:5432/kb',
  REDIS_URL: 'redis://redis:6379',
  PARSER_WORKER_URL: 'http://parser-worker:8000',
  PARSER_INTERNAL_TOKEN: 'test-internal-token',
  RAW_DOCS_PATH: '/data/raw-docs',
  CHROMA_URL: 'http://chroma:8000',
};

describe('embedding configuration', () => {
  it('keeps local infrastructure runnable when embedding is disabled', () => {
    const environment = parseEnvironment(baseEnvironment);
    expect(environment.EMBEDDING_PROVIDER).toBe('none');
    expect(environment.DASHSCOPE_API_KEY).toBe('');
  });

  it('requires provider credentials, region, model and HTTPS base URL when enabled', () => {
    expect(() => parseEnvironment({ ...baseEnvironment, EMBEDDING_PROVIDER: 'alibaba' })).toThrow(
      'Invalid application configuration: EMBEDDING_MODEL, EMBEDDING_REGION, DASHSCOPE_API_KEY, ALIBABA_BASE_URL',
    );
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        EMBEDDING_PROVIDER: 'alibaba',
        EMBEDDING_MODEL: 'text-embedding-v4',
        EMBEDDING_REGION: 'cn-beijing',
        DASHSCOPE_API_KEY: 'test-key',
        ALIBABA_BASE_URL: 'http://example.test/v1',
      }),
    ).toThrow('Invalid application configuration: ALIBABA_BASE_URL');
  });

  it('accepts the verified Alibaba text-embedding-v4 configuration', () => {
    const environment = parseEnvironment({
      ...baseEnvironment,
      EMBEDDING_PROVIDER: 'alibaba',
      EMBEDDING_MODEL: 'text-embedding-v4',
      EMBEDDING_DIMENSIONS: '1024',
      EMBEDDING_BATCH_SIZE: '10',
      EMBEDDING_REGION: 'cn-beijing',
      DASHSCOPE_API_KEY: 'test-key',
      ALIBABA_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    expect(environment).toMatchObject({
      EMBEDDING_PROVIDER: 'alibaba',
      EMBEDDING_MODEL: 'text-embedding-v4',
      EMBEDDING_DIMENSIONS: 1024,
      EMBEDDING_BATCH_SIZE: 10,
    });
  });
});
