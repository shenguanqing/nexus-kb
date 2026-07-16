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
    PARSER_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
    RAW_DOCS_PATH: z.string().min(1),
    CHROMA_URL: z.url(),
    AUTH_REQUIRED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DEV_TENANT_ID: z.string().min(1).default('local-dev'),
    DEV_USER_ID: z.string().min(1).default('local-user'),
    DEV_DEPARTMENT: z.string().min(1).default('general'),
    DEV_SENSITIVITY: z.enum(['public', 'internal', 'confidential']).default('internal'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).max(1_073_741_824).default(52_428_800),
    INGESTION_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    INGESTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
    INGESTION_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
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
    EMBEDDING_PROVIDER: z.enum(['none', 'alibaba']).default('none'),
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
    if (environment.EMBEDDING_PROVIDER !== 'alibaba') return;
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
    if (environment.ALIBABA_BASE_URL) {
      try {
        const url = new URL(environment.ALIBABA_BASE_URL);
        if (url.protocol !== 'https:') throw new Error('not https');
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['ALIBABA_BASE_URL'],
          message: 'must be a valid HTTPS URL',
        });
      }
    }
  });

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
    databaseConfigured: Boolean(environment.DATABASE_URL),
    redisConfigured: Boolean(environment.REDIS_URL),
    parserWorkerEndpoint: safeEndpoint(environment.PARSER_WORKER_URL),
    parserTokenConfigured: Boolean(environment.PARSER_INTERNAL_TOKEN),
    vectorStoreProvider: environment.VECTOR_STORE_PROVIDER,
    chromaEndpoint: safeEndpoint(environment.CHROMA_URL),
    embeddingProvider: environment.EMBEDDING_PROVIDER,
    embeddingModel: environment.EMBEDDING_MODEL || null,
    embeddingDimensions: environment.EMBEDDING_DIMENSIONS,
    embeddingRegion: environment.EMBEDDING_REGION || null,
    embeddingKeyConfigured: Boolean(environment.DASHSCOPE_API_KEY),
    embeddingEndpoint: environment.ALIBABA_BASE_URL
      ? safeEndpoint(environment.ALIBABA_BASE_URL)
      : null,
  };
}

@Injectable()
export class AppConfig {
  readonly values: Environment;

  constructor() {
    this.values = parseEnvironment(process.env);
  }
}
