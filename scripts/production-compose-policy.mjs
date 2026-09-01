import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { productionComposeArguments } from './production-operations.mjs';

const hardenedServices = [
  'api',
  'api-migrate',
  'web',
  'parser-worker',
  'parser-worker-dwg',
  'reranker-worker',
  'deployment-agent',
  'postgres',
  'redis',
  'chroma',
  'tika',
];
const modelSecrets = [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'DASHSCOPE_API_KEY',
  'CUSTOM_API_KEY',
  'DATABASE_URL',
  'SYSTEM_CONFIG_ENCRYPTION_KEY',
  'DEPLOYMENT_AGENT_TOKEN',
];

export function assertProductionComposePolicy(configuration) {
  for (const name of hardenedServices) {
    const service = configuration.services?.[name];
    if (!service) throw new Error(`PRODUCTION_SERVICE_MISSING:${name}`);
    if (service.read_only !== true) throw new Error(`READ_ONLY_REQUIRED:${name}`);
    if (!service.cap_drop?.includes('ALL')) throw new Error(`CAP_DROP_ALL_REQUIRED:${name}`);
    if (!Number.isFinite(service.pids_limit) || service.pids_limit < 1) {
      throw new Error(`PIDS_LIMIT_REQUIRED:${name}`);
    }
    if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(service.image ?? '')) {
      throw new Error(`IMMUTABLE_SERVICE_IMAGE_REQUIRED:${name}`);
    }
    if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(String(service.user ?? ''))) {
      throw new Error(`NON_ROOT_USER_REQUIRED:${name}`);
    }
  }
  if ((configuration.services.api.ports ?? []).length !== 0) {
    throw new Error('API_HOST_PORT_FORBIDDEN');
  }
  if ((configuration.services.web.ports ?? []).length !== 2) {
    throw new Error('WEB_TLS_PORTS_REQUIRED');
  }
  for (const serviceName of ['parser-worker', 'parser-worker-dwg', 'reranker-worker']) {
    const environment = configuration.services[serviceName].environment ?? {};
    for (const name of modelSecrets) {
      if (name in environment) throw new Error(`SECRET_ENV_FORBIDDEN:${serviceName}:${name}`);
    }
  }
  for (const secretName of [
    'database_url',
    'deployment_agent_token',
    'parser_internal_token',
    'postgres_password',
    'redis_password',
    'redis_url',
    'system_config_encryption_key',
    'tls_certificate',
    'tls_key',
  ]) {
    if (!configuration.secrets?.[secretName]?.file) {
      throw new Error(`PRODUCTION_SECRET_MISSING:${secretName}`);
    }
  }
}

export function checkProductionCompose() {
  const result = spawnSync(
    'docker',
    [...productionComposeArguments(), 'config', '--format', 'json'],
    { encoding: 'utf8', env: process.env, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error('PRODUCTION_COMPOSE_CONFIG_FAILED');
  assertProductionComposePolicy(JSON.parse(result.stdout));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkProductionCompose();
  process.stdout.write('Production Compose policy passed.\n');
}
