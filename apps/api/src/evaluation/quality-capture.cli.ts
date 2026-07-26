import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  qualityEvaluationDatasetSchema,
  qualityEvaluationRunSchema,
  qualitySourceSchema,
  qualityVariantSchema,
} from '@nexus-kb/contracts';
import type { QualityObservation, QualitySource } from '@nexus-kb/contracts';
import { z } from 'zod';

import { AppModule } from '../app.module';
import type { Identity } from '../auth/identity';
import { AppConfig } from '../config/app-config';
import type { QualityQueryObserver } from '../knowledge/knowledge-query.service';
import { KnowledgeQueryService } from '../knowledge/knowledge-query.service';
import { ChromaVectorStore } from '../vector-store/chroma-vector-store';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;

const identitySchema = z
  .object({
    tenantId: z.string().min(1).max(128),
    userId: z.string().min(1).max(256),
    department: z.string().min(1).max(128),
    roles: z.array(z.string().min(1).max(64)).max(32),
    allowedSensitivities: z
      .array(z.enum(['public', 'internal', 'confidential']))
      .min(1)
      .max(3),
    capabilities: z
      .array(
        z.enum([
          'documents:read',
          'documents:write',
          'documents:delete',
          'audit:read',
          'system:read',
          'access:read',
          'access:write',
        ]),
      )
      .min(1)
      .max(16),
    defaultSensitivity: z.enum(['public', 'internal', 'confidential']),
  })
  .strict()
  .refine(
    (value) => value.allowedSensitivities.includes(value.defaultSensitivity),
    'defaultSensitivity must be allowed',
  )
  .refine((value) => value.capabilities.includes('documents:read'), 'documents:read is required');

const identityProfilesSchema = z
  .object({
    schemaVersion: z.literal(1),
    profiles: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/), identitySchema),
  })
  .strict()
  .refine((value) => Object.keys(value.profiles).length > 0, 'at least one profile is required');

interface CliArguments {
  dataset: string;
  identities: string;
  variant: 'vector_top_5' | 'vector_top_20_rerank_top_5';
  output: string;
}

function parseArguments(arguments_: string[]): CliArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(
        'Usage: quality:capture --dataset <file> --identities <file> --variant <variant> --output <file>',
      );
    }
    const normalizedKey = key.slice(2);
    if (values.has(normalizedKey)) throw new Error('Duplicate quality capture argument');
    values.set(normalizedKey, value);
  }
  const allowed = new Set(['dataset', 'identities', 'variant', 'output']);
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    throw new Error('Unknown quality capture argument');
  }
  const dataset = values.get('dataset');
  const identities = values.get('identities');
  const variant = qualityVariantSchema.safeParse(values.get('variant'));
  const output = values.get('output');
  if (!dataset || !identities || !variant.success || !output) {
    throw new Error(
      'Usage: quality:capture --dataset <file> --identities <file> --variant <variant> --output <file>',
    );
  }
  return { dataset, identities, variant: variant.data, output };
}

async function readPrivateJson(path: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_INPUT_BYTES) {
    throw new Error('Evaluation input must be a regular JSON file no larger than 10 MiB');
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error('Evaluation input permissions must be 0600 or stricter');
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function main(): Promise<void> {
  if (process.env.RUN_PAID_PROVIDER_TESTS !== 'true') {
    throw new Error('RUN_PAID_PROVIDER_TESTS=true is required for quality capture');
  }
  const arguments_ = parseArguments(process.argv.slice(2));
  const paths = {
    dataset: resolve(arguments_.dataset),
    identities: resolve(arguments_.identities),
    output: resolve(arguments_.output),
  };
  if ([paths.dataset, paths.identities].includes(paths.output)) {
    throw new Error('Evaluation output must not overwrite an input file');
  }
  const [datasetInput, identitiesInput] = await Promise.all([
    readPrivateJson(paths.dataset),
    readPrivateJson(paths.identities),
  ]);
  const dataset = qualityEvaluationDatasetSchema.parse(datasetInput);
  const identities = identityProfilesSchema.parse(identitiesInput);
  for (const item of dataset.cases) {
    if (!identities.profiles[item.identityProfile]) {
      throw new Error(`Missing identity profile for case ${item.id}`);
    }
  }

  process.env.INDEX_MIGRATION_ACTION = 'prepare';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const config = app.get(AppConfig);
    assertConfiguration(arguments_.variant, config);
    assertRateLimits(dataset, identities.profiles, config);
    const queryService = app.get(KnowledgeQueryService);
    const vectorStoreInfo = app.get(ChromaVectorStore).info();
    if (
      !vectorStoreInfo.enabled ||
      !vectorStoreInfo.collectionName ||
      !vectorStoreInfo.fingerprint
    ) {
      throw new Error('Quality capture requires an enabled, fingerprinted vector collection');
    }
    const observations: QualityObservation[] = [];
    for (const item of dataset.cases) {
      const identity = identities.profiles[item.identityProfile] as Identity;
      const traceId = randomUUID();
      const startedAt = Date.now();
      let vectorSources: QualitySource[] = [];
      let finalSources: QualitySource[] = [];
      const observer: QualityQueryObserver = {
        recordVectorSources: (sources) => {
          vectorSources = qualitySourceSchema.array().parse(sources);
        },
        recordFinalSources: (sources) => {
          finalSources = qualitySourceSchema.array().parse(sources);
        },
      };
      try {
        const response = await queryService.query(
          { question: item.question },
          identity,
          traceId,
          observer,
        );
        observations.push({
          caseId: item.id,
          traceId,
          noAnswer: response.noAnswer,
          vectorSources,
          finalSources,
          citationSources: response.sources.map((source) => ({
            documentId: source.documentId,
            page: source.page,
            sheet: source.sheet,
            chunkIds: source.chunkIds,
          })),
          durationMs: Date.now() - startedAt,
          costUsd: null,
          errorCode: null,
        });
      } catch (error) {
        observations.push({
          caseId: item.id,
          traceId,
          noAnswer: true,
          vectorSources,
          finalSources,
          citationSources: [],
          durationMs: Date.now() - startedAt,
          costUsd: null,
          errorCode: safeErrorCode(error),
        });
      }
    }
    const run = qualityEvaluationRunSchema.parse({
      schemaVersion: 1,
      datasetId: dataset.datasetId,
      variant: arguments_.variant,
      createdAt: new Date().toISOString(),
      configuration: runConfiguration(arguments_.variant, config, vectorStoreInfo),
      observations,
    });
    await mkdir(dirname(paths.output), { recursive: true, mode: 0o700 });
    await writeFile(paths.output, `${JSON.stringify(run, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    process.stdout.write(`Quality capture completed: ${arguments_.variant}\n`);
  } finally {
    await app.close();
  }
}

function assertConfiguration(variant: CliArguments['variant'], config: AppConfig): void {
  const values = config.values;
  if (values.QUERY_ANSWER_MODE !== 'strict') {
    throw new Error('Quality capture requires QUERY_ANSWER_MODE=strict');
  }
  if (values.EMBEDDING_PROVIDER === 'none' || values.LLM_PROVIDER === 'none') {
    throw new Error('Quality capture requires configured Embedding and LLM providers');
  }
  const matches =
    variant === 'vector_top_5'
      ? values.QUERY_RECALL_TOP_K === 5 && values.RERANK_PROVIDER === 'none'
      : values.QUERY_RECALL_TOP_K === 20 &&
        values.RERANK_PROVIDER !== 'none' &&
        values.RERANK_TOP_K === 5;
  if (!matches) throw new Error('Application configuration does not match the selected variant');
}

function assertRateLimits(
  dataset: z.infer<typeof qualityEvaluationDatasetSchema>,
  profiles: Record<string, z.infer<typeof identitySchema>>,
  config: AppConfig,
): void {
  const users = new Map<string, number>();
  const tenants = new Map<string, number>();
  for (const item of dataset.cases) {
    const identity = profiles[item.identityProfile]!;
    const userKey = `${identity.tenantId}:${identity.userId}`;
    users.set(userKey, (users.get(userKey) ?? 0) + 1);
    tenants.set(identity.tenantId, (tenants.get(identity.tenantId) ?? 0) + 1);
  }
  if (
    Math.max(...users.values()) > config.values.QUERY_USER_RATE_LIMIT_PER_MINUTE ||
    Math.max(...tenants.values()) > config.values.QUERY_TENANT_RATE_LIMIT_PER_MINUTE
  ) {
    throw new Error('Configured query rate limits are too low for this sequential evaluation run');
  }
}

function runConfiguration(
  variant: CliArguments['variant'],
  config: AppConfig,
  vectorStoreInfo: ReturnType<ChromaVectorStore['info']>,
) {
  return {
    recallTopK: config.values.QUERY_RECALL_TOP_K,
    rerankEnabled: variant === 'vector_top_20_rerank_top_5',
    rerankTopK: variant === 'vector_top_20_rerank_top_5' ? config.values.RERANK_TOP_K : null,
    embeddingProvider: config.values.EMBEDDING_PROVIDER,
    embeddingModel: config.values.EMBEDDING_MODEL,
    embeddingFingerprint: vectorStoreInfo.fingerprint,
    collectionName: vectorStoreInfo.collectionName,
    rerankProvider: variant === 'vector_top_20_rerank_top_5' ? config.values.RERANK_PROVIDER : null,
    rerankModel: variant === 'vector_top_20_rerank_top_5' ? config.values.RERANK_MODEL : null,
  };
}

function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,128}$/.test(code)) return code;
  }
  return 'EVALUATION_QUERY_FAILED';
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Quality capture failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
