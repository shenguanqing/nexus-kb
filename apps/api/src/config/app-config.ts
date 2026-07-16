import { Injectable } from '@nestjs/common';
import { z } from 'zod';

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

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
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
});

export type Environment = z.infer<typeof environmentSchema>;

@Injectable()
export class AppConfig {
  readonly values: Environment;

  constructor() {
    const parsed = environmentSchema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
      throw new Error(`Invalid application configuration: ${fields}`);
    }
    if (parsed.data.CHUNK_OVERLAP_TOKENS >= parsed.data.CHUNK_MAX_TOKENS) {
      throw new Error(
        'Invalid application configuration: CHUNK_OVERLAP_TOKENS must be less than CHUNK_MAX_TOKENS',
      );
    }
    this.values = parsed.data;
  }
}
