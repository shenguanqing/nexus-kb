import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const excluded = new Set(['scripts/check-secrets.mjs', '.env.example', 'docs/02-技术设计.md']);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{24,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/,
];

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((file) => !excluded.has(file));

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (patterns.some((pattern) => pattern.test(content))) findings.push(file);
}

const exampleEnvironment = readFileSync('.env.example', 'utf8');
for (const name of [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'DASHSCOPE_API_KEY',
  'CUSTOM_API_KEY',
  'SYSTEM_CONFIG_ENCRYPTION_KEY',
  'DEPLOYMENT_AGENT_TOKEN',
  'KEYCLOAK_TEST_ADMIN_PASSWORD',
  'KEYCLOAK_TEST_USER_PASSWORD',
]) {
  const value = exampleEnvironment.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
  if (value) findings.push(`.env.example:${name}`);
}

if (findings.length > 0) {
  console.error(`疑似密钥出现在：${findings.join(', ')}`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files checked).`);
