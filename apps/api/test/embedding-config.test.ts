import { describe, expect, it } from 'vitest';

import { parseEnvironment, safeConfigurationSummary } from '../src/config/app-config';

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

  it('applies isolated defaults for development, test and production', () => {
    expect(parseEnvironment({ ...baseEnvironment, NODE_ENV: 'development' })).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      AUTH_REQUIRED: false,
      DEV_TENANT_ID: 'local-dev',
    });
    expect(parseEnvironment({ ...baseEnvironment, NODE_ENV: 'test' })).toMatchObject({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      AUTH_REQUIRED: false,
      DEV_TENANT_ID: 'test-tenant',
    });
    expect(() => parseEnvironment({ ...baseEnvironment, NODE_ENV: 'production' })).toThrow(
      'Invalid application configuration: OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URI',
    );
    expect(
      parseEnvironment({
        ...baseEnvironment,
        NODE_ENV: 'production',
        OIDC_ISSUER: 'https://identity.example.test',
        OIDC_AUDIENCE: 'nexus-kb',
        OIDC_JWKS_URI: 'https://identity.example.test/.well-known/jwks.json',
      }),
    ).toMatchObject({
      NODE_ENV: 'production',
      API_HOST: '0.0.0.0',
      AUTH_REQUIRED: true,
      DEV_TENANT_ID: 'disabled',
    });
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        NODE_ENV: 'production',
        AUTH_REQUIRED: 'false',
      }),
    ).toThrow('Invalid application configuration: AUTH_REQUIRED');
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

  it('builds a configuration summary without credentials or connection strings', () => {
    const environment = parseEnvironment({
      ...baseEnvironment,
      DATABASE_URL: 'postgresql://secret-user:secret-password@postgres:5432/kb',
      REDIS_URL: 'redis://:secret-password@redis:6379',
      PARSER_INTERNAL_TOKEN: 'super-secret-internal-token',
      EMBEDDING_PROVIDER: 'alibaba',
      EMBEDDING_MODEL: 'text-embedding-v4',
      EMBEDDING_REGION: 'cn-beijing',
      DASHSCOPE_API_KEY: 'super-secret-provider-key',
      ALIBABA_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    const serialized = JSON.stringify(safeConfigurationSummary(environment));

    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('DATABASE_URL');
    expect(serialized).toContain('"embeddingKeyConfigured":true');
    expect(serialized).toContain('https://dashscope.aliyuncs.com');
  });
});
