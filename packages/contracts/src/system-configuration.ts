import { z } from 'zod';

export const managedConfigurationFieldSchema = z.enum([
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_FALLBACK_PROVIDER',
  'LLM_FALLBACK_MODEL',
  'LLM_TEMPERATURE',
  'LLM_MAX_OUTPUT_TOKENS',
  'LLM_REQUEST_TIMEOUT_MS',
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
  'MAX_PARSE_BYTES',
  'MAX_ELEMENTS',
  'MAX_SPREADSHEET_ROWS',
  'MAX_PDF_PAGES',
  'MAX_IMAGE_PIXELS',
  'OCR_LANGUAGES',
  'OCR_CONFIDENCE_WARNING_THRESHOLD',
  'MAX_CAD_ENTITIES',
  'MAX_CAD_INSERT_DEPTH',
  'DWG_CONVERSION_TIMEOUT_SECONDS',
  'QUERY_ANSWER_MODE',
  'QUERY_RECALL_TOP_K',
  'QUERY_MAX_DISTANCE',
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

export const deploymentServiceSchema = z.enum(['api', 'parser-worker', 'reranker-worker']);
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
