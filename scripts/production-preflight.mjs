import { X509Certificate, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const imageVariables = [
  'NEXUS_KB_API_IMAGE',
  'NEXUS_KB_WEB_IMAGE',
  'NEXUS_KB_PARSER_IMAGE',
  'NEXUS_KB_PARSER_DWG_IMAGE',
  'NEXUS_KB_RERANKER_IMAGE',
  'NEXUS_KB_DEPLOYMENT_AGENT_IMAGE',
  'NEXUS_KB_TIKA_IMAGE',
  'NEXUS_KB_POSTGRES_IMAGE',
  'NEXUS_KB_REDIS_IMAGE',
  'NEXUS_KB_CHROMA_IMAGE',
];
const inlineSecretVariables = [
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
  'REDIS_URL',
  'PARSER_INTERNAL_TOKEN',
  'RERANK_INTERNAL_TOKEN',
  'SYSTEM_CONFIG_ENCRYPTION_KEY',
  'DEPLOYMENT_AGENT_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'DASHSCOPE_API_KEY',
  'CUSTOM_API_KEY',
];
const requiredSecretFiles = [
  'database_url',
  'deployment_agent_token',
  'parser_internal_token',
  'postgres_password',
  'redis_password',
  'redis_url',
  'system_config_encryption_key',
  'tls_certificate.pem',
  'tls_key.pem',
];

function decodeEnvironmentValue(rawValue) {
  const value = rawValue.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error('PRODUCTION_ENV_INVALID_QUOTING');
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvironmentFile(content) {
  const environment = {};
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) throw new Error(`PRODUCTION_ENV_INVALID_LINE:${index + 1}`);
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`PRODUCTION_ENV_INVALID_KEY:${index + 1}`);
    }
    environment[key] = decodeEnvironmentValue(trimmed.slice(separator + 1));
  }
  return environment;
}

function requireHttpsUrl(environment, name) {
  let url;
  try {
    url = new URL(environment[name] ?? '');
  } catch {
    throw new Error(`${name}_INVALID`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${name}_INVALID`);
  return url;
}

export function validateProductionEnvironment(environment) {
  if (environment.NODE_ENV !== 'production') throw new Error('NODE_ENV_MUST_BE_PRODUCTION');
  if (environment.AUTH_REQUIRED !== 'true') throw new Error('AUTH_REQUIRED_MUST_BE_TRUE');
  if (environment.PASSWORD_AUTH_ENABLED !== 'false') {
    throw new Error('PRODUCTION_OIDC_MUST_BE_ENABLED');
  }
  if (environment.ALLOW_CONFIDENTIAL_TO_CLOUD !== 'false') {
    throw new Error('CONFIDENTIAL_CLOUD_EGRESS_MUST_BE_DISABLED');
  }

  const publicHost = environment.NEXUS_KB_PUBLIC_HOST ?? '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(publicHost)) {
    throw new Error('NEXUS_KB_PUBLIC_HOST_INVALID');
  }
  requireHttpsUrl(environment, 'OIDC_ISSUER');
  requireHttpsUrl(environment, 'OIDC_JWKS_URI');
  requireHttpsUrl(environment, 'OIDC_AUTHORIZATION_ENDPOINT');
  requireHttpsUrl(environment, 'OIDC_TOKEN_ENDPOINT');
  const redirect = requireHttpsUrl(environment, 'OIDC_REDIRECT_URI');
  if (redirect.host !== publicHost || redirect.pathname !== '/auth/callback') {
    throw new Error('OIDC_REDIRECT_URI_MISMATCH');
  }
  if (!(environment.OIDC_AUDIENCE ?? '').trim() || !(environment.OIDC_CLIENT_ID ?? '').trim()) {
    throw new Error('OIDC_CLIENT_CONFIGURATION_REQUIRED');
  }

  for (const name of inlineSecretVariables) {
    if ((environment[name] ?? '') !== '') throw new Error(`INLINE_SECRET_FORBIDDEN:${name}`);
  }
  if ((environment.PASSWORD_AUTH_USERS_JSON ?? '[]') !== '[]') {
    throw new Error('INLINE_SECRET_FORBIDDEN:PASSWORD_AUTH_USERS_JSON');
  }
  for (const name of imageVariables) {
    if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(environment[name] ?? '')) {
      throw new Error(`IMMUTABLE_IMAGE_REQUIRED:${name}`);
    }
  }
  for (const name of ['NEXUS_KB_DEPLOYMENT_UID', 'NEXUS_KB_DOCKER_GID']) {
    const value = Number(environment[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name}_INVALID`);
  }
  if (
    environment.NEXUS_KB_COMPOSE_PROJECT_NAME &&
    !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(environment.NEXUS_KB_COMPOSE_PROJECT_NAME)
  ) {
    throw new Error('NEXUS_KB_COMPOSE_PROJECT_NAME_INVALID');
  }
}

function readSecretFile(secretDirectory, name) {
  const filename = path.join(secretDirectory, name);
  const stats = statSync(filename);
  if (!stats.isFile() || (stats.mode & 0o077) !== 0)
    throw new Error(`SECRET_PERMISSIONS_INVALID:${name}`);
  if (stats.size < 1 || stats.size > 1024 * 1024) throw new Error(`SECRET_SIZE_INVALID:${name}`);
  return readFileSync(filename, 'utf8').trimEnd();
}

export function validateProductionSecrets(secretDirectory, publicHost, now = new Date()) {
  const directoryStats = statSync(secretDirectory);
  if (!directoryStats.isDirectory() || (directoryStats.mode & 0o077) !== 0) {
    throw new Error('SECRET_DIRECTORY_PERMISSIONS_INVALID');
  }
  const secrets = Object.fromEntries(
    requiredSecretFiles.map((name) => [name, readSecretFile(secretDirectory, name)]),
  );
  if (!secrets.database_url.startsWith('postgresql://'))
    throw new Error('DATABASE_URL_SECRET_INVALID');
  if (!secrets.redis_url.startsWith('redis://') && !secrets.redis_url.startsWith('rediss://')) {
    throw new Error('REDIS_URL_SECRET_INVALID');
  }
  for (const name of ['deployment_agent_token', 'parser_internal_token']) {
    if (secrets[name].length < 32) throw new Error(`SECRET_TOO_SHORT:${name}`);
  }
  for (const name of ['postgres_password', 'redis_password']) {
    if (secrets[name].length < 16) throw new Error(`SECRET_TOO_SHORT:${name}`);
  }
  let encryptionKey;
  try {
    encryptionKey = Buffer.from(secrets.system_config_encryption_key, 'base64');
  } catch {
    throw new Error('SYSTEM_CONFIG_ENCRYPTION_KEY_INVALID');
  }
  if (encryptionKey.length !== 32) throw new Error('SYSTEM_CONFIG_ENCRYPTION_KEY_INVALID');

  const certificate = new X509Certificate(secrets['tls_certificate.pem']);
  if (!certificate.checkHost(publicHost)) throw new Error('TLS_CERTIFICATE_HOST_MISMATCH');
  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  if (validFrom > now || validTo.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) {
    throw new Error('TLS_CERTIFICATE_VALIDITY_INVALID');
  }
  const privateKey = createPrivateKey(secrets['tls_key.pem']);
  const certificateKey = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const privatePublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (
    certificateKey.length !== privatePublicKey.length ||
    !timingSafeEqual(certificateKey, privatePublicKey)
  ) {
    throw new Error('TLS_PRIVATE_KEY_MISMATCH');
  }
}

export function runProductionPreflight(options = {}) {
  const workspace = options.workspace ?? process.cwd();
  const environmentFile = options.environmentFile ?? path.join(workspace, '.env.production');
  const fileEnvironment = parseEnvironmentFile(readFileSync(environmentFile, 'utf8'));
  const overrides = { ...process.env, ...options.environment };
  const environment = Object.fromEntries(
    Object.entries(fileEnvironment).map(([name, value]) => [name, overrides[name] ?? value]),
  );
  validateProductionEnvironment(environment);
  const configuredSecretDirectory =
    environment.NEXUS_KB_SECRETS_DIR ?? path.join(workspace, 'config/production-secrets');
  const secretDirectory = path.resolve(workspace, configuredSecretDirectory);
  validateProductionSecrets(secretDirectory, environment.NEXUS_KB_PUBLIC_HOST);
  return { environmentFile, secretDirectory, environment };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runProductionPreflight();
  process.stdout.write('Production preflight passed.\n');
}
