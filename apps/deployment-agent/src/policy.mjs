const allowedServices = new Set(['api', 'parser-worker', 'parser-worker-dwg', 'reranker-worker']);
const allowedKeys = new Set([
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_FALLBACK_PROVIDER',
  'LLM_FALLBACK_MODEL',
  'LLM_TEMPERATURE',
  'LLM_MAX_OUTPUT_TOKENS',
  'LLM_REQUEST_TIMEOUT_MS',
  'LLM_MAX_ATTEMPTS',
  'LLM_RETRY_BASE_DELAY_MS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_REGION',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_REGION',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_REGION',
  'DASHSCOPE_API_KEY',
  'ALIBABA_BASE_URL',
  'ALIBABA_REGION',
  'CUSTOM_API_KEY',
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
  'QUERY_MAX_RERANK_INPUT_CHARS',
  'QUERY_USER_RATE_LIMIT_PER_MINUTE',
  'QUERY_TENANT_RATE_LIMIT_PER_MINUTE',
]);

export function validateEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_ENV');
  const environment = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!allowedKeys.has(key) || typeof rawValue !== 'string' || rawValue.length > 4096) {
      throw new Error('INVALID_ENV');
    }
    if (/[\r\n\0]/.test(rawValue)) throw new Error('INVALID_ENV');
    environment[key] = rawValue;
  }
  if ([...allowedKeys].some((key) => !(key in environment))) throw new Error('INCOMPLETE_ENV');
  return environment;
}

export function validatePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_BODY');
  if (
    typeof value.deploymentId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.deploymentId,
    )
  ) {
    throw new Error('INVALID_DEPLOYMENT');
  }
  if (
    !Array.isArray(value.services) ||
    value.services.length < 1 ||
    value.services.some((service) => !allowedServices.has(service))
  ) {
    throw new Error('INVALID_SERVICES');
  }
  const expectedCallback = `http://api:3000/v1/internal/deployments/${value.deploymentId}/result`;
  if (value.callbackUrl !== expectedCallback) throw new Error('INVALID_CALLBACK');
  return {
    deploymentId: value.deploymentId,
    services: [...new Set(value.services)],
    environment: validateEnvironment(value.environment),
    previousEnvironment: validateEnvironment(value.previousEnvironment),
    callbackUrl: expectedCallback,
  };
}

export function managedEnvironmentFixture(overrides = {}) {
  return Object.fromEntries([...allowedKeys].map((key) => [key, overrides[key] ?? '']));
}
