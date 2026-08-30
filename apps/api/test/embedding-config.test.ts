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
  it('keeps local infrastructure runnable when embedding is disabled and enables DWG conversion by default', () => {
    const environment = parseEnvironment(baseEnvironment);
    expect(environment.EMBEDDING_PROVIDER).toBe('none');
    expect(environment.DASHSCOPE_API_KEY).toBe('');
    expect(environment.DWG_CONVERSION_ENABLED).toBe(true);
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
      'Invalid application configuration: OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URI, OIDC_AUTHORIZATION_ENDPOINT, OIDC_TOKEN_ENDPOINT, OIDC_CLIENT_ID, OIDC_REDIRECT_URI',
    );
    expect(
      parseEnvironment({
        ...baseEnvironment,
        NODE_ENV: 'production',
        OIDC_ISSUER: 'https://identity.example.test',
        OIDC_AUDIENCE: 'nexus-kb',
        OIDC_JWKS_URI: 'https://identity.example.test/.well-known/jwks.json',
        OIDC_AUTHORIZATION_ENDPOINT: 'https://identity.example.test/authorize',
        OIDC_TOKEN_ENDPOINT: 'https://identity.example.test/token',
        OIDC_CLIENT_ID: 'nexus-kb-web',
        OIDC_REDIRECT_URI: 'https://knowledge.example.test/auth/callback',
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

  it('requires explicit secure account configuration when password login is enabled', () => {
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        AUTH_REQUIRED: 'true',
        PASSWORD_AUTH_ENABLED: 'true',
      }),
    ).toThrow('Invalid application configuration: PASSWORD_AUTH_USERS_JSON');
    expect(
      parseEnvironment({
        ...baseEnvironment,
        AUTH_REQUIRED: 'true',
        PASSWORD_AUTH_ENABLED: 'true',
        PASSWORD_AUTH_USERS_JSON:
          '[{"username":"admin","password":"password-for-test","tenantId":"tenant-a","userId":"admin-a","department":"platform","roles":["admin"],"allowedSensitivities":["public","internal","confidential"],"capabilities":["documents:read","access:read","access:write"],"defaultSensitivity":"internal"}]',
      }),
    ).toMatchObject({ PASSWORD_AUTH_ENABLED: true, AUTH_REQUIRED: true });
    expect(
      parseEnvironment({
        ...baseEnvironment,
        NODE_ENV: 'production',
        PASSWORD_AUTH_ENABLED: 'true',
        PASSWORD_AUTH_USERS_JSON:
          '[{"username":"admin","password":"password-for-test","tenantId":"tenant-a","userId":"admin-a","department":"platform","roles":["admin"],"allowedSensitivities":["public","internal","confidential"],"capabilities":["documents:read","access:read","access:write"],"defaultSensitivity":"internal"}]',
      }),
    ).toMatchObject({ NODE_ENV: 'production', PASSWORD_AUTH_ENABLED: true, AUTH_REQUIRED: true });
  });

  it('requires a complete public-client PKCE configuration when OIDC is enabled', () => {
    const oidcEnvironment = {
      ...baseEnvironment,
      AUTH_REQUIRED: 'true',
      OIDC_ISSUER: 'https://identity.example.test',
      OIDC_AUDIENCE: 'nexus-kb',
      OIDC_JWKS_URI: 'https://identity.example.test/.well-known/jwks.json',
      OIDC_AUTHORIZATION_ENDPOINT: 'https://identity.example.test/authorize',
      OIDC_TOKEN_ENDPOINT: 'https://identity.example.test/token',
      OIDC_CLIENT_ID: 'nexus-kb-web',
      OIDC_REDIRECT_URI: 'https://knowledge.example.test/auth/callback',
    };
    expect(() => parseEnvironment({ ...oidcEnvironment, OIDC_SCOPES_JSON: '["profile"]' })).toThrow(
      'Invalid application configuration: OIDC_SCOPES_JSON',
    );
    expect(() =>
      parseEnvironment({
        ...oidcEnvironment,
        OIDC_REDIRECT_URI: 'https://knowledge.example.test/auth/callback?next=/ask',
      }),
    ).toThrow('Invalid application configuration: OIDC_REDIRECT_URI');
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

  it('accepts Google retrieval embeddings only with the verified model task contract', () => {
    const environment = parseEnvironment({
      ...baseEnvironment,
      EMBEDDING_PROVIDER: 'google',
      EMBEDDING_MODEL: 'gemini-embedding-001',
      EMBEDDING_DIMENSIONS: '768',
      EMBEDDING_TASK_MODE: 'retrieval_document_query',
      EMBEDDING_REGION: 'global',
      GEMINI_API_KEY: 'test-google-key',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
    });
    expect(environment).toMatchObject({
      EMBEDDING_PROVIDER: 'google',
      EMBEDDING_MODEL: 'gemini-embedding-001',
      EMBEDDING_DIMENSIONS: 768,
      EMBEDDING_TASK_MODE: 'retrieval_document_query',
    });
    expect(safeConfigurationSummary(environment)).toMatchObject({
      embeddingKeyConfigured: true,
      embeddingEndpoint: 'https://generativelanguage.googleapis.com',
    });
  });

  it('rejects Google models, dimensions and task rules outside the adapter contract', () => {
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        EMBEDDING_PROVIDER: 'google',
        EMBEDDING_MODEL: 'embedding-001',
        EMBEDDING_DIMENSIONS: '64',
        EMBEDDING_TASK_MODE: 'symmetric',
        EMBEDDING_REGION: 'global',
        GEMINI_API_KEY: 'test-google-key',
        GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/custom',
      }),
    ).toThrow(
      'Invalid application configuration: EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_TASK_MODE, GEMINI_BASE_URL',
    );
  });

  it('accepts an approved local Ollama embedding configuration without a cloud key', () => {
    const environment = parseEnvironment({
      ...baseEnvironment,
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3:latest',
      EMBEDDING_DIMENSIONS: '1024',
      EMBEDDING_REGION: 'local',
      OLLAMA_BASE_URL: 'http://host.docker.internal:11434',
    });

    expect(environment).toMatchObject({
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3:latest',
      EMBEDDING_DIMENSIONS: 1024,
      EMBEDDING_REGION: 'local',
    });
    expect(safeConfigurationSummary(environment)).toMatchObject({
      embeddingKeyConfigured: true,
      embeddingEndpoint: 'http://host.docker.internal:11434',
    });
  });

  it('rejects non-local Ollama endpoints and non-local regions', () => {
    expect(() =>
      parseEnvironment({
        ...baseEnvironment,
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'bge-m3:latest',
        EMBEDDING_REGION: 'global',
        OLLAMA_BASE_URL: 'https://models.example.test',
      }),
    ).toThrow('Invalid application configuration: EMBEDDING_REGION, OLLAMA_BASE_URL');
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
