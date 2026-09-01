import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { assertQualityBaselineGate } from './quality-baseline-gate.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function privateInput(name) {
  const value = argument(name);
  if (!value) throw new Error(`Missing ${name}`);
  const filename = path.resolve(value);
  const stats = statSync(filename);
  if (!stats.isFile() || (stats.mode & 0o077) !== 0) {
    throw new Error(`PRIVATE_INPUT_PERMISSIONS_INVALID:${name}`);
  }
  return filename;
}

async function run(arguments_, overrides = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', arguments_, {
      stdio: 'inherit',
      env: { ...process.env, QUERY_ANSWER_MODE: 'strict', ...overrides },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`QUALITY_COMMAND_FAILED:${code ?? signal ?? 'unknown'}`));
    });
  });
}

async function main() {
  if (process.env.RUN_PAID_PROVIDER_TESTS !== 'true') {
    throw new Error('RUN_PAID_PROVIDER_TESTS=true is required');
  }
  const dataset = privateInput('--dataset');
  const identities = privateInput('--identities');
  const outputArgument = argument('--output');
  if (!outputArgument) throw new Error('Missing --output');
  const output = path.resolve(outputArgument);
  if (output === '/') throw new Error('QUALITY_OUTPUT_INVALID');
  mkdirSync(output, { recursive: false, mode: 0o700 });
  chmodSync(output, 0o700);

  const baseline = path.join(output, 'vector-top-5.run.json');
  const rerank = path.join(output, 'vector-top-20-rerank-top-5.run.json');
  const report = path.join(output, 'report.json');
  await run(
    [
      '--filter',
      '@nexus-kb/api',
      'quality:capture',
      '--',
      '--dataset',
      dataset,
      '--identities',
      identities,
      '--variant',
      'vector_top_5',
      '--output',
      baseline,
    ],
    { QUERY_RECALL_TOP_K: '5', RERANK_PROVIDER: 'none' },
  );
  chmodSync(baseline, 0o600);
  await run(
    [
      '--filter',
      '@nexus-kb/api',
      'quality:capture',
      '--',
      '--dataset',
      dataset,
      '--identities',
      identities,
      '--variant',
      'vector_top_20_rerank_top_5',
      '--output',
      rerank,
    ],
    { QUERY_RECALL_TOP_K: '20', RERANK_PROVIDER: 'local_bge', RERANK_TOP_K: '5' },
  );
  chmodSync(rerank, 0o600);
  await run([
    '--filter',
    '@nexus-kb/api',
    'quality:evaluate',
    '--',
    '--dataset',
    dataset,
    '--baseline',
    baseline,
    '--rerank',
    rerank,
    '--output',
    report,
  ]);
  chmodSync(report, 0o600);
  const datasetValue = JSON.parse(readFileSync(dataset, 'utf8'));
  const reportValue = JSON.parse(readFileSync(report, 'utf8'));
  const result = assertQualityBaselineGate(datasetValue, reportValue);
  process.stdout.write(
    `${JSON.stringify({ report, baseline: result.baseline, rerank: result.rerank, rerankRecommendation: result.rerankRecommendation })}\n`,
  );
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Quality baseline failed'}\n`);
  process.exitCode = 1;
});
