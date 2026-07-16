import { Injectable } from '@nestjs/common';
import { z } from 'zod';

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
    this.values = parsed.data;
  }
}
