import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { qualityEvaluationDatasetSchema, qualityEvaluationRunSchema } from '@nexus-kb/contracts';

import { QualityEvaluator } from './quality-evaluator';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;

interface CliArguments {
  dataset: string;
  baseline: string;
  rerank: string;
  output: string;
}

function parseArguments(arguments_: string[]): CliArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(
        'Usage: quality:evaluate --dataset <file> --baseline <file> --rerank <file> --output <file>',
      );
    }
    const normalizedKey = key.slice(2);
    if (values.has(normalizedKey)) throw new Error('Duplicate quality evaluation argument');
    values.set(normalizedKey, value);
  }
  const allowed = new Set(['dataset', 'baseline', 'rerank', 'output']);
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    throw new Error('Unknown quality evaluation argument');
  }
  const dataset = values.get('dataset');
  const baseline = values.get('baseline');
  const rerank = values.get('rerank');
  const output = values.get('output');
  if (!dataset || !baseline || !rerank || !output) {
    throw new Error(
      'Usage: quality:evaluate --dataset <file> --baseline <file> --rerank <file> --output <file>',
    );
  }
  return { dataset, baseline, rerank, output };
}

async function readJson(path: string): Promise<unknown> {
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
  const arguments_ = parseArguments(process.argv.slice(2));
  const paths = {
    dataset: resolve(arguments_.dataset),
    baseline: resolve(arguments_.baseline),
    rerank: resolve(arguments_.rerank),
    output: resolve(arguments_.output),
  };
  if ([paths.dataset, paths.baseline, paths.rerank].includes(paths.output)) {
    throw new Error('Evaluation output must not overwrite an input file');
  }
  const [datasetInput, baselineInput, rerankInput] = await Promise.all([
    readJson(paths.dataset),
    readJson(paths.baseline),
    readJson(paths.rerank),
  ]);
  const dataset = qualityEvaluationDatasetSchema.parse(datasetInput);
  const baseline = qualityEvaluationRunSchema.parse(baselineInput);
  const rerank = qualityEvaluationRunSchema.parse(rerankInput);
  const report = new QualityEvaluator().evaluate(dataset, baseline, rerank);
  await mkdir(dirname(paths.output), { recursive: true, mode: 0o700 });
  await writeFile(paths.output, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(`Quality evaluation completed: ${report.rerankRecommendation.decision}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Quality evaluation failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
