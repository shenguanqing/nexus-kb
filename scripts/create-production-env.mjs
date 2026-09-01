import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

import { parseEnvironmentFile } from './production-preflight.mjs';

const source = readFileSync('.env.example', 'utf8');
const parsed = parseEnvironmentFile(source);
const overrides = {
  NODE_ENV: 'production',
  AUTH_REQUIRED: 'true',
  PASSWORD_AUTH_ENABLED: 'false',
  ALLOW_CONFIDENTIAL_TO_CLOUD: 'false',
};
const secretNames = new Set([
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
  'KEYCLOAK_TEST_ADMIN_PASSWORD',
  'KEYCLOAK_TEST_USER_PASSWORD',
]);
const output = source
  .split(/\r?\n/)
  .map((line) => {
    const separator = line.indexOf('=');
    if (separator < 1 || line.trimStart().startsWith('#')) return line;
    const name = line.slice(0, separator);
    if (!(name in parsed)) return line;
    if (secretNames.has(name)) return `${name}=`;
    if (name === 'PASSWORD_AUTH_USERS_JSON') return `${name}=[]`;
    if (name in overrides) return `${name}=${overrides[name]}`;
    return line;
  })
  .join('\n');

writeFileSync('.env.production', output, { flag: 'wx', mode: 0o600 });
chmodSync('.env.production', 0o600);
process.stdout.write('Created .env.production with inline secrets removed.\n');
