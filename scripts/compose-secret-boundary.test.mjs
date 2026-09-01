import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function serviceBlock(source, serviceName) {
  const start = source.indexOf(`  ${serviceName}:\n`);
  if (start < 0) throw new Error(`Missing service ${serviceName}`);
  const remainder = source.slice(start + 1);
  const next = remainder.search(/\n  [a-zA-Z0-9][a-zA-Z0-9-]*:\n/);
  return next < 0 ? remainder : remainder.slice(0, next);
}

test('keeps API and Provider secrets out of Parser and Reranker environments', async () => {
  const base = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
  const dwg = await readFile(new URL('../compose.dwg.yaml', import.meta.url), 'utf8');
  for (const block of [
    serviceBlock(base, 'parser-worker'),
    serviceBlock(base, 'reranker-worker'),
    serviceBlock(dwg, 'parser-worker-dwg'),
  ]) {
    assert.doesNotMatch(block, /^\s+env_file:/m);
    assert.doesNotMatch(block, /(OPENAI|GEMINI|DEEPSEEK|DASHSCOPE|CUSTOM)_API_KEY/);
    assert.doesNotMatch(block, /DATABASE_URL|SYSTEM_CONFIG_ENCRYPTION_KEY|DEPLOYMENT_AGENT_TOKEN/);
  }
});

test('replaces the Parser entrypoint process when loading file secrets', async () => {
  const entrypoint = await readFile(
    new URL('../apps/parser-worker/bin/nexus-parser-worker-entrypoint', import.meta.url),
    'utf8',
  );
  assert.match(entrypoint, /^\s*exec \/usr\/local\/bin\/nexus-load-secrets "\$0" "\$@"\s*$/m);
});
