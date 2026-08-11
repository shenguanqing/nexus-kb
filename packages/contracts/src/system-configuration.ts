import { z } from 'zod';

export const managedConfigurationFieldSchema = z.enum([
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_FALLBACK_PROVIDER',
  'LLM_FALLBACK_MODEL',
  'LLM_TEMPERATURE',
  'LLM_MAX_OUTPUT_TOKENS',
  'LLM_REQUEST_TIMEOUT_MS',
  'LLM_MAX_ATTEMPTS',
  'LLM_RETRY_BASE_DELAY_MS',
  'OPENAI_BASE_URL',
  'OPENAI_REGION',
  'GEMINI_BASE_URL',
  'GEMINI_REGION',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_REGION',
  'ALIBABA_BASE_URL',
  'ALIBABA_REGION',
  'CUSTOM_BASE_URL',
  'CUSTOM_REGION',
  'RERANK_PROVIDER',
  'RERANK_MODEL',
  'RERANK_BASE_URL',
  'RERANK_REGION',
  'RERANK_TOP_K',
  'RERANK_REQUEST_TIMEOUT_MS',
  'PARSER_REQUEST_TIMEOUT_MS',
  'DWG_CONVERSION_ENABLED',
  'DWG_OUTPUT_VERSION',
  'MAX_DWG_CONVERTED_BYTES',
  'MAX_PARSE_BYTES',
  'MAX_ELEMENTS',
  'MAX_SPREADSHEET_ROWS',
  'MAX_PDF_PAGES',
  'MAX_IMAGE_PIXELS',
  'OCR_LANGUAGES',
  'OCR_CONFIDENCE_WARNING_THRESHOLD',
  'MAX_CAD_ENTITIES',
  'MAX_CAD_INSERT_DEPTH',
  'CAD_TILED_PREVIEW_ENABLED',
  'CAD_PREVIEW_TILE_COST_THRESHOLD',
  'CAD_PREVIEW_TILE_SOURCE_BYTES_THRESHOLD',
  'CAD_PREVIEW_TILE_SIZE',
  'CAD_PREVIEW_MAX_ZOOM',
  'CAD_PREVIEW_METATILE_RADIUS',
  'CAD_PREVIEW_TILE_CACHE_BYTES',
  'CAD_PREVIEW_RENDER_TIMEOUT_SECONDS',
  'CAD_PREVIEW_RENDER_MEMORY_BYTES',
  'DWG_CONVERSION_TIMEOUT_SECONDS',
  'TIKA_ENABLED',
  'TIKA_REQUEST_TIMEOUT_SECONDS',
  'MAX_TIKA_RESPONSE_BYTES',
  'MAX_ARCHIVE_ENTRIES',
  'MAX_ARCHIVE_UNCOMPRESSED_BYTES',
  'MAX_UPLOAD_BYTES',
  'INGESTION_CONCURRENCY',
  'INGESTION_MAX_ATTEMPTS',
  'INGESTION_RETRY_BASE_DELAY_MS',
  'QUERY_ANSWER_MODE',
  'QUERY_RECALL_TOP_K',
  'QUERY_MAX_DISTANCE',
  'QUERY_NEIGHBOR_WINDOW',
  'QUERY_MAX_MERGED_CONTEXT_CHARS',
  'QUERY_MAX_LLM_CONTEXT_CHARS',
  'QUERY_MAX_RERANK_INPUT_CHARS',
  'QUERY_USER_RATE_LIMIT_PER_MINUTE',
  'QUERY_TENANT_RATE_LIMIT_PER_MINUTE',
]);

export const managedConfigurationSecretSchema = z.enum([
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'DASHSCOPE_API_KEY',
  'CUSTOM_API_KEY',
]);

const configurationValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const systemConfigurationUpdateRequestSchema = z
  .object({
    values: z.partialRecord(managedConfigurationFieldSchema, configurationValueSchema).default({}),
    secrets: z
      .partialRecord(managedConfigurationSecretSchema, z.string().min(1).max(4096))
      .default({}),
    changeReason: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine(
    (request) => Object.keys(request.values).length + Object.keys(request.secrets).length > 0,
    'must update at least one field',
  );

export const configurationVersionStatusSchema = z.enum(['draft', 'active', 'failed', 'superseded']);

export const systemConfigurationVersionSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    status: configurationVersionStatusSchema,
    values: z.record(managedConfigurationFieldSchema, configurationValueSchema),
    secretConfigured: z.record(managedConfigurationSecretSchema, z.boolean()),
    changedKeys: z.array(z.string().min(1)),
    changeReason: z.string().min(1),
    createdBy: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    activatedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const systemConfigurationResponseSchema = z
  .object({
    deploymentAgentAvailable: z.boolean(),
    embeddingManagedSeparately: z.literal(true),
    effectiveValues: z.record(managedConfigurationFieldSchema, configurationValueSchema),
    secretConfigured: z.record(managedConfigurationSecretSchema, z.boolean()),
    current: systemConfigurationVersionSchema.nullable(),
    versions: z.array(systemConfigurationVersionSchema),
  })
  .strict();

export const deploymentServiceSchema = z.enum([
  'api',
  'parser-worker',
  'parser-worker-dwg',
  'reranker-worker',
]);
export const systemDeploymentStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'rolled_back',
  'failed',
]);

export const systemDeploymentSchema = z
  .object({
    id: z.uuid(),
    status: systemDeploymentStatusSchema,
    services: z.array(deploymentServiceSchema).min(1),
    configVersion: z.number().int().positive(),
    changeReason: z.string().min(1).max(500),
    previousVersion: z.number().int().positive().nullable(),
    rollbackAvailable: z.boolean(),
    errorCode: z.string().min(1).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const systemDeploymentListResponseSchema = z
  .object({ deployments: z.array(systemDeploymentSchema) })
  .strict();

export const systemDeploymentAcceptedSchema = z
  .object({ deployment: systemDeploymentSchema })
  .strict();

export const deploymentAgentResultSchema = z
  .object({
    status: z.enum(['succeeded', 'rolled_back', 'failed']),
    errorCode: z.string().min(1).max(128).nullable(),
  })
  .strict();

export type ManagedConfigurationField = z.infer<typeof managedConfigurationFieldSchema>;
export type ManagedConfigurationSecret = z.infer<typeof managedConfigurationSecretSchema>;
export type SystemConfigurationUpdateRequest = z.infer<
  typeof systemConfigurationUpdateRequestSchema
>;
export type SystemConfigurationVersion = z.infer<typeof systemConfigurationVersionSchema>;
export type SystemConfigurationResponse = z.infer<typeof systemConfigurationResponseSchema>;
export type DeploymentService = z.infer<typeof deploymentServiceSchema>;
export type SystemDeployment = z.infer<typeof systemDeploymentSchema>;
export type SystemDeploymentAccepted = z.infer<typeof systemDeploymentAcceptedSchema>;
export type DeploymentAgentResult = z.infer<typeof deploymentAgentResultSchema>;
