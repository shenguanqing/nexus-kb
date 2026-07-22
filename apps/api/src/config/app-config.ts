import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const environmentProfiles = {
  development: {
    API_HOST: '127.0.0.1',
    LOG_LEVEL: 'info',
    AUTH_REQUIRED: 'false',
    DEV_TENANT_ID: 'local-dev',
    DEV_USER_ID: 'local-user',
    DEV_DEPARTMENT: 'general',
  },
  test: {
    API_HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    AUTH_REQUIRED: 'false',
    DEV_TENANT_ID: 'test-tenant',
    DEV_USER_ID: 'test-user',
    DEV_DEPARTMENT: 'test-department',
  },
  production: {
    API_HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    AUTH_REQUIRED: 'true',
    DEV_TENANT_ID: 'disabled',
    DEV_USER_ID: 'disabled',
    DEV_DEPARTMENT: 'disabled',
  },
} as const;

const businessRedactionRuleSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/),
    pattern: z.string().min(1).max(512),
    flags: z
      .string()
      .regex(/^[imu]*$/)
      .default('u'),
  })
  .strict();

const cloudEgressRuleSchema = z
  .object({
    sensitivity: z.enum(['public', 'internal', 'confidential']),
    providerId: z.string().min(1).max(64),
    region: z.string().min(1).max(64),
    allowed: z.boolean(),
  })
  .strict();

const modelPricingSchema = z
  .record(
    z.string().regex(/^[a-z0-9_-]{1,64}:[^\s:]{1,128}$/i),
    z
      .object({
        input: z.number().nonnegative().max(1_000_000),
        output: z.number().nonnegative().max(1_000_000),
      })
      .strict(),
  )
  .refine((value) => Object.keys(value).length <= 100, 'must contain at most 100 model prices');

const sensitivitySchema = z.enum(['public', 'internal', 'confidential']);
const capabilitySchema = z.enum([
  'documents:read',
  'documents:write',
  'documents:delete',
  'audit:read',
  'system:read',
  'access:read',
  'access:write',
]);
const passwordAuthUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/),
    password: z.string().min(12).max(256),
    tenantId: z.string().trim().min(1).max(128),
    userId: z.string().trim().min(1).max(256),
    department: z.string().trim().min(1).max(128),
    roles: z.array(z.string().trim().min(1).max(64)).max(32),
    allowedSensitivities: z.array(sensitivitySchema).min(1).max(3),
    capabilities: z.array(capabilitySchema).min(1).max(16),
    defaultSensitivity: sensitivitySchema,
  })
  .strict()
  .superRefine((user, context) => {
    if (!user.allowedSensitivities.includes(user.defaultSensitivity)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultSensitivity'],
        message: 'must be included in allowedSensitivities',
      });
    }
  });
const passwordAuthUsersSchema = z
  .array(passwordAuthUserSchema)
  .max(100)
  .superRefine((users, context) => {
    const usernames = new Set<string>();
    for (const [index, user] of users.entries()) {
      const normalized = user.username.toLowerCase();
      if (usernames.has(normalized)) {
        context.addIssue({ code: 'custom', path: [index, 'username'], message: 'must be unique' });
      }
      usernames.add(normalized);
    }
  });
const jwtAlgorithmSchema = z.enum(['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']);
const llmProviderSchema = z.enum(['none', 'openai', 'google', 'deepseek', 'alibaba', 'custom']);
const ollamaEmbeddingHosts = new Set(['host.docker.internal', 'ollama']);

function isApprovedOllamaEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ollamaEmbeddingHosts.has(url.hostname.toLowerCase()) &&
      url.port === '11434' &&
      (url.pathname === '' || url.pathname === '/') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function jsonEnvironmentValue<T extends z.ZodType>(schema: T, fallback: string) {
  return z
    .string()
    .default(fallback)
    .transform((value, context): z.infer<T> => {
      try {
        return schema.parse(JSON.parse(value) as unknown);
      } catch {
        context.addIssue({ code: 'custom', message: 'must contain valid JSON configuration' });
        return z.NEVER;
      }
    });
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url().refine((url) => url.startsWith('postgresql://'), 'must use postgresql'),
    REDIS_URL: z.url().refine((url) => url.startsWith('redis://'), 'must use redis'),
    PARSER_WORKER_URL: z.url(),
    PARSER_INTERNAL_TOKEN: z.string().min(16),
    PARSER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(900_000).default(240_000),
    RAW_DOCS_PATH: z.string().min(1),
    DWG_CONVERSION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CHROMA_URL: z.url(),
    AUTH_REQUIRED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    PASSWORD_AUTH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    PASSWORD_AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
    PASSWORD_AUTH_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
    PASSWORD_AUTH_WINDOW_SECONDS: z.coerce.number().int().min(30).max(86_400).default(900),
    PASSWORD_AUTH_USERS_JSON: jsonEnvironmentValue(passwordAuthUsersSchema, '[]'),
    DEV_TENANT_ID: z.string().min(1).default('local-dev'),
    DEV_USER_ID: z.string().min(1).default('local-user'),
    DEV_DEPARTMENT: z.string().min(1).default('general'),
    DEV_SENSITIVITY: sensitivitySchema.default('internal'),
    DEV_ROLES_JSON: jsonEnvironmentValue(z.array(z.string().min(1).max(64)).max(32), '[]'),
    DEV_ALLOWED_SENSITIVITIES_JSON: jsonEnvironmentValue(
      z.array(sensitivitySchema).min(1).max(3),
      '["public","internal","confidential"]',
    ),
    DEV_CAPABILITIES_JSON: jsonEnvironmentValue(
      z.array(capabilitySchema).min(1).max(16),
      '["documents:read","documents:write","documents:delete","audit:read","system:read","access:read","access:write"]',
    ),
    OIDC_ISSUER: z.string().trim().max(512).default(''),
    OIDC_AUDIENCE: z.string().trim().max(256).default(''),
    OIDC_JWKS_URI: z.string().trim().max(2048).default(''),
    OIDC_ALLOWED_ALGORITHMS_JSON: jsonEnvironmentValue(
      z.array(jwtAlgorithmSchema).min(1).max(6),
      '["RS256"]',
    ),
    OIDC_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().min(0).max(300).default(5),
    OIDC_JWKS_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5000),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).max(1_073_741_824).default(52_428_800),
    INGESTION_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    INGESTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
    INGESTION_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    INDEX_MIGRATION_ACTION: z.enum(['none', 'prepare', 'activate']).default('none'),
    CHUNK_MAX_TOKENS: z.coerce.number().int().min(64).max(8192).default(600),
    CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).max(2048).default(80),
    REDACTION_POLICY_VERSION: z
      .string()
      .regex(/^[a-zA-Z0-9._-]{1,64}$/)
      .default('v1'),
    BUSINESS_REDACTION_RULES_JSON: jsonEnvironmentValue(
      z.array(businessRedactionRuleSchema).max(100),
      '[]',
    ),
    ALLOW_CONFIDENTIAL_TO_CLOUD: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CLOUD_EGRESS_RULES_JSON: jsonEnvironmentValue(z.array(cloudEgressRuleSchema).max(100), '[]'),
    EMBEDDING_PROVIDER: z.enum(['none', 'alibaba', 'ollama']).default('none'),
    EMBEDDING_MODEL: z.string().trim().max(128).default(''),
    EMBEDDING_DIMENSIONS: z.coerce
      .number()
      .int()
      .refine((value) => [64, 128, 256, 512, 768, 1024, 1536, 2048].includes(value))
      .default(1024),
    EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(10).default(10),
    EMBEDDING_TASK_MODE: z.enum(['symmetric']).default('symmetric'),
    EMBEDDING_REGION: z.string().trim().max(64).default(''),
    EMBEDDING_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(60_000),
    EMBEDDING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(3),
    EMBEDDING_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1).max(10_000).default(500),
    DASHSCOPE_API_KEY: z.string().trim().default(''),
    ALIBABA_BASE_URL: z.string().trim().default(''),
    ALIBABA_REGION: z.string().trim().max(64).default('cn-beijing'),
    OLLAMA_BASE_URL: z.string().trim().default(''),
    LLM_PROVIDER: llmProviderSchema.default('none'),
    LLM_MODEL: z.string().trim().max(128).default(''),
    LLM_FALLBACK_PROVIDER: llmProviderSchema.default('none'),
    LLM_FALLBACK_MODEL: z.string().trim().max(128).default(''),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(65_536).default(1200),
    LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(90_000),
    LLM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(3),
    LLM_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1).max(10_000).default(500),
    OPENAI_API_KEY: z.string().trim().default(''),
    OPENAI_BASE_URL: z.string().trim().default('https://api.openai.com/v1'),
    OPENAI_REGION: z.string().trim().max(64).default('global'),
    GEMINI_API_KEY: z.string().trim().default(''),
    GEMINI_BASE_URL: z.string().trim().default('https://generativelanguage.googleapis.com/v1beta'),
    GEMINI_REGION: z.string().trim().max(64).default('global'),
    DEEPSEEK_API_KEY: z.string().trim().default(''),
    DEEPSEEK_BASE_URL: z.string().trim().default('https://api.deepseek.com'),
    DEEPSEEK_REGION: z.string().trim().max(64).default('global'),
    CUSTOM_API_KEY: z.string().trim().default(''),
    CUSTOM_BASE_URL: z.string().trim().default(''),
    CUSTOM_REGION: z.string().trim().max(64).default(''),
    RERANK_PROVIDER: z.enum(['none', 'alibaba']).default('none'),
    RERANK_MODEL: z.string().trim().max(128).default('qwen3-rerank'),
    RERANK_BASE_URL: z.string().trim().default(''),
    RERANK_REGION: z.string().trim().max(64).default('cn-beijing'),
    RERANK_TOP_K: z.coerce.number().int().min(1).max(100).default(5),
    RERANK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(60_000),
    MODEL_PRICING_USD_PER_MILLION_TOKENS_JSON: jsonEnvironmentValue(modelPricingSchema, '{}'),
    QUERY_RECALL_TOP_K: z.coerce.number().int().min(1).max(100).default(20),
    QUERY_MAX_DISTANCE: z.coerce.number().min(0).max(2).default(0.45),
    QUERY_NEIGHBOR_WINDOW: z.coerce.number().int().min(0).max(3).default(1),
    QUERY_MAX_MERGED_CONTEXT_CHARS: z.coerce.number().int().min(1000).max(100_000).default(20_000),
    QUERY_MAX_RERANK_INPUT_CHARS: z.coerce.number().int().min(1000).max(1_000_000).default(120_000),
    QUERY_USER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
    QUERY_TENANT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(200),
    VECTOR_STORE_PROVIDER: z.enum(['chroma']).default('chroma'),
    CHROMA_TENANT: z.string().trim().min(1).max(128).default('default_tenant'),
    CHROMA_DATABASE: z.string().trim().min(1).max(128).default('default_database'),
    CHROMA_COLLECTION_PREFIX: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{1,31}$/)
      .default('nexuskb'),
    CHROMA_SCHEMA_VERSION: z.coerce.number().int().min(1).max(9999).default(1),
    CHROMA_UPSERT_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    CHROMA_QUERY_MAX_TOP_K: z.coerce.number().int().min(1).max(1000).default(100),
  })
  .superRefine((environment, context) => {
    if (!environment.DEV_ALLOWED_SENSITIVITIES_JSON.includes(environment.DEV_SENSITIVITY)) {
      context.addIssue({
        code: 'custom',
        path: ['DEV_SENSITIVITY'],
        message: 'must be included in DEV_ALLOWED_SENSITIVITIES_JSON',
      });
    }
    if (environment.PASSWORD_AUTH_ENABLED && !environment.AUTH_REQUIRED) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_REQUIRED'],
        message: 'must be true when password authentication is enabled',
      });
    }
    if (environment.PASSWORD_AUTH_ENABLED && environment.PASSWORD_AUTH_USERS_JSON.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['PASSWORD_AUTH_USERS_JSON'],
        message: 'must include at least one account when password authentication is enabled',
      });
    }
    if (environment.AUTH_REQUIRED && !environment.PASSWORD_AUTH_ENABLED) {
      const requiredFields = [
        ['OIDC_ISSUER', environment.OIDC_ISSUER],
        ['OIDC_AUDIENCE', environment.OIDC_AUDIENCE],
        ['OIDC_JWKS_URI', environment.OIDC_JWKS_URI],
      ] as const;
      for (const [field, value] of requiredFields) {
        if (!value) context.addIssue({ code: 'custom', path: [field], message: 'is required' });
      }
      if (environment.OIDC_JWKS_URI) {
        try {
          const url = new URL(environment.OIDC_JWKS_URI);
          if (url.username || url.password) throw new Error('credentials in URL');
          if (environment.NODE_ENV === 'production' && url.protocol !== 'https:') {
            throw new Error('not https');
          }
        } catch {
          context.addIssue({
            code: 'custom',
            path: ['OIDC_JWKS_URI'],
            message: 'must be a valid URL and use HTTPS in production',
          });
        }
      }
    }
    if (environment.EMBEDDING_PROVIDER === 'alibaba') {
      const requiredFields = [
        ['EMBEDDING_MODEL', environment.EMBEDDING_MODEL],
        ['EMBEDDING_REGION', environment.EMBEDDING_REGION],
        ['DASHSCOPE_API_KEY', environment.DASHSCOPE_API_KEY],
        ['ALIBABA_BASE_URL', environment.ALIBABA_BASE_URL],
      ] as const;
      for (const [field, value] of requiredFields) {
        if (!value) context.addIssue({ code: 'custom', path: [field], message: 'is required' });
      }
      if (environment.EMBEDDING_MODEL && environment.EMBEDDING_MODEL !== 'text-embedding-v4') {
        context.addIssue({
          code: 'custom',
          path: ['EMBEDDING_MODEL'],
          message: 'must be text-embedding-v4 for the current Alibaba adapter',
        });
      }
    }
    if (environment.EMBEDDING_PROVIDER === 'ollama') {
      const requiredFields = [
        ['EMBEDDING_MODEL', environment.EMBEDDING_MODEL],
        ['EMBEDDING_REGION', environment.EMBEDDING_REGION],
        ['OLLAMA_BASE_URL', environment.OLLAMA_BASE_URL],
      ] as const;
      for (const [field, value] of requiredFields) {
        if (!value) context.addIssue({ code: 'custom', path: [field], message: 'is required' });
      }
      if (environment.EMBEDDING_REGION && environment.EMBEDDING_REGION !== 'local') {
        context.addIssue({
          code: 'custom',
          path: ['EMBEDDING_REGION'],
          message: 'must be local for the Ollama provider',
        });
      }
      if (environment.OLLAMA_BASE_URL && !isApprovedOllamaEndpoint(environment.OLLAMA_BASE_URL)) {
        context.addIssue({
          code: 'custom',
          path: ['OLLAMA_BASE_URL'],
          message: 'must be an approved local HTTP endpoint on port 11434',
        });
      }
    }
    const selectedLlmProviders = [
      [environment.LLM_PROVIDER, environment.LLM_MODEL, 'LLM_MODEL'],
      [environment.LLM_FALLBACK_PROVIDER, environment.LLM_FALLBACK_MODEL, 'LLM_FALLBACK_MODEL'],
    ] as const;
    for (const [provider, model, modelField] of selectedLlmProviders) {
      if (provider === 'none') continue;
      if (!model) context.addIssue({ code: 'custom', path: [modelField], message: 'is required' });
      const credentials = llmCredentials(environment, provider);
      if (!credentials.apiKey) {
        context.addIssue({
          code: 'custom',
          path: [credentials.apiKeyField],
          message: 'is required',
        });
      }
      if (!credentials.baseUrl) {
        context.addIssue({
          code: 'custom',
          path: [credentials.baseUrlField],
          message: 'is required',
        });
      }
    }
    if (environment.RERANK_PROVIDER === 'alibaba') {
      if (!environment.DASHSCOPE_API_KEY) {
        context.addIssue({ code: 'custom', path: ['DASHSCOPE_API_KEY'], message: 'is required' });
      }
      if (!environment.RERANK_BASE_URL) {
        context.addIssue({ code: 'custom', path: ['RERANK_BASE_URL'], message: 'is required' });
      }
      if (environment.RERANK_MODEL !== 'qwen3-rerank') {
        context.addIssue({
          code: 'custom',
          path: ['RERANK_MODEL'],
          message: 'must be qwen3-rerank for the current Alibaba adapter',
        });
      }
    }
    const endpointFields = [
      ['ALIBABA_BASE_URL', environment.ALIBABA_BASE_URL],
      ['OPENAI_BASE_URL', environment.OPENAI_BASE_URL],
      ['GEMINI_BASE_URL', environment.GEMINI_BASE_URL],
      ['DEEPSEEK_BASE_URL', environment.DEEPSEEK_BASE_URL],
      ['CUSTOM_BASE_URL', environment.CUSTOM_BASE_URL],
      ['RERANK_BASE_URL', environment.RERANK_BASE_URL],
    ] as const;
    for (const [field, value] of endpointFields) {
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:') throw new Error('not https');
      } catch {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'must be a valid HTTPS URL',
        });
      }
    }
  });

function llmCredentials(
  environment: {
    OPENAI_API_KEY: string;
    OPENAI_BASE_URL: string;
    GEMINI_API_KEY: string;
    GEMINI_BASE_URL: string;
    DEEPSEEK_API_KEY: string;
    DEEPSEEK_BASE_URL: string;
    DASHSCOPE_API_KEY: string;
    ALIBABA_BASE_URL: string;
    CUSTOM_API_KEY: string;
    CUSTOM_BASE_URL: string;
  },
  provider: Exclude<z.infer<typeof llmProviderSchema>, 'none'>,
): { apiKey: string; apiKeyField: string; baseUrl: string; baseUrlField: string } {
  if (provider === 'openai') {
    return {
      apiKey: environment.OPENAI_API_KEY,
      apiKeyField: 'OPENAI_API_KEY',
      baseUrl: environment.OPENAI_BASE_URL,
      baseUrlField: 'OPENAI_BASE_URL',
    };
  }
  if (provider === 'google') {
    return {
      apiKey: environment.GEMINI_API_KEY,
      apiKeyField: 'GEMINI_API_KEY',
      baseUrl: environment.GEMINI_BASE_URL,
      baseUrlField: 'GEMINI_BASE_URL',
    };
  }
  if (provider === 'deepseek') {
    return {
      apiKey: environment.DEEPSEEK_API_KEY,
      apiKeyField: 'DEEPSEEK_API_KEY',
      baseUrl: environment.DEEPSEEK_BASE_URL,
      baseUrlField: 'DEEPSEEK_BASE_URL',
    };
  }
  if (provider === 'alibaba') {
    return {
      apiKey: environment.DASHSCOPE_API_KEY,
      apiKeyField: 'DASHSCOPE_API_KEY',
      baseUrl: environment.ALIBABA_BASE_URL,
      baseUrlField: 'ALIBABA_BASE_URL',
    };
  }
  return {
    apiKey: environment.CUSTOM_API_KEY,
    apiKeyField: 'CUSTOM_API_KEY',
    baseUrl: environment.CUSTOM_BASE_URL,
    baseUrlField: 'CUSTOM_BASE_URL',
  };
}

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv): Environment {
  const nodeEnvironment = z
    .enum(['development', 'test', 'production'])
    .catch('development')
    .parse(input.NODE_ENV);
  const parsed = environmentSchema.safeParse({
    ...environmentProfiles[nodeEnvironment],
    ...input,
    NODE_ENV: nodeEnvironment,
  });
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid application configuration: ${fields}`);
  }
  if (parsed.data.CHUNK_OVERLAP_TOKENS >= parsed.data.CHUNK_MAX_TOKENS) {
    throw new Error(
      'Invalid application configuration: CHUNK_OVERLAP_TOKENS must be less than CHUNK_MAX_TOKENS',
    );
  }
  if (
    parsed.data.RERANK_TOP_K > parsed.data.QUERY_RECALL_TOP_K ||
    parsed.data.QUERY_RECALL_TOP_K > parsed.data.CHROMA_QUERY_MAX_TOP_K
  ) {
    throw new Error(
      'Invalid application configuration: RERANK_TOP_K <= QUERY_RECALL_TOP_K <= CHROMA_QUERY_MAX_TOP_K',
    );
  }
  if (parsed.data.QUERY_MAX_MERGED_CONTEXT_CHARS > parsed.data.QUERY_MAX_RERANK_INPUT_CHARS) {
    throw new Error(
      'Invalid application configuration: QUERY_MAX_MERGED_CONTEXT_CHARS <= QUERY_MAX_RERANK_INPUT_CHARS',
    );
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.AUTH_REQUIRED) {
    throw new Error('Invalid application configuration: AUTH_REQUIRED');
  }
  return parsed.data;
}

function safeEndpoint(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export function safeConfigurationSummary(environment: Environment): Record<string, unknown> {
  return {
    nodeEnv: environment.NODE_ENV,
    apiHost: environment.API_HOST,
    apiPort: environment.API_PORT,
    logLevel: environment.LOG_LEVEL,
    authRequired: environment.AUTH_REQUIRED,
    passwordAuthEnabled: environment.PASSWORD_AUTH_ENABLED,
    passwordAuthAccountCount: environment.PASSWORD_AUTH_USERS_JSON.length,
    oidcIssuer: environment.OIDC_ISSUER || null,
    oidcAudience: environment.OIDC_AUDIENCE || null,
    oidcJwksEndpoint: environment.OIDC_JWKS_URI ? safeEndpoint(environment.OIDC_JWKS_URI) : null,
    databaseConfigured: Boolean(environment.DATABASE_URL),
    redisConfigured: Boolean(environment.REDIS_URL),
    parserWorkerEndpoint: safeEndpoint(environment.PARSER_WORKER_URL),
    parserTokenConfigured: Boolean(environment.PARSER_INTERNAL_TOKEN),
    dwgConversionEnabled: environment.DWG_CONVERSION_ENABLED,
    vectorStoreProvider: environment.VECTOR_STORE_PROVIDER,
    chromaEndpoint: safeEndpoint(environment.CHROMA_URL),
    embeddingProvider: environment.EMBEDDING_PROVIDER,
    embeddingModel: environment.EMBEDDING_MODEL || null,
    embeddingDimensions: environment.EMBEDDING_DIMENSIONS,
    embeddingRegion: environment.EMBEDDING_REGION || null,
    embeddingKeyConfigured:
      environment.EMBEDDING_PROVIDER === 'ollama' ? true : Boolean(environment.DASHSCOPE_API_KEY),
    embeddingEndpoint:
      environment.EMBEDDING_PROVIDER === 'ollama'
        ? environment.OLLAMA_BASE_URL
          ? safeEndpoint(environment.OLLAMA_BASE_URL)
          : null
        : environment.ALIBABA_BASE_URL
          ? safeEndpoint(environment.ALIBABA_BASE_URL)
          : null,
    llmProvider: environment.LLM_PROVIDER,
    llmModel: environment.LLM_MODEL || null,
    llmFallbackProvider: environment.LLM_FALLBACK_PROVIDER,
    llmFallbackModel: environment.LLM_FALLBACK_MODEL || null,
    llmKeyConfigured:
      environment.LLM_PROVIDER === 'none'
        ? false
        : Boolean(llmCredentials(environment, environment.LLM_PROVIDER).apiKey),
    rerankProvider: environment.RERANK_PROVIDER,
    rerankModel: environment.RERANK_PROVIDER === 'none' ? null : environment.RERANK_MODEL,
    rerankKeyConfigured:
      environment.RERANK_PROVIDER === 'none' ? false : Boolean(environment.DASHSCOPE_API_KEY),
  };
}

@Injectable()
export class AppConfig {
  readonly values: Environment;

  constructor() {
    this.values = parseEnvironment(process.env);
  }
}
