import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';

import { parseEnvironmentFile } from './production-preflight.mjs';

const productionFileEnvironment = existsSync('.env.production')
  ? parseEnvironmentFile(readFileSync('.env.production', 'utf8'))
  : {};

const productionComposeBaseArguments = [
  'compose',
  '--project-directory',
  process.cwd(),
  '--project-name',
  process.env.NEXUS_KB_COMPOSE_PROJECT_NAME ??
    productionFileEnvironment.NEXUS_KB_COMPOSE_PROJECT_NAME ??
    'nexus-kb',
  '-f',
  'compose.yaml',
  '-f',
  'compose.dwg.yaml',
  '-f',
  'compose.production.yaml',
  '--profile',
  'configuration',
  '--env-file',
  '.env.production',
];

export function productionComposeArguments() {
  return [
    ...productionComposeBaseArguments,
    ...(existsSync('config/runtime.env') ? ['--env-file', 'config/runtime.env'] : []),
  ];
}

export async function runDocker(arguments_, options = {}) {
  let outputDescriptor;
  let inputDescriptor;
  try {
    if (options.outputFile) outputDescriptor = openSync(options.outputFile, 'wx', 0o600);
    if (options.inputFile) inputDescriptor = openSync(options.inputFile, 'r');
    await new Promise((resolve, reject) => {
      const child = spawn('docker', [...productionComposeArguments(), ...arguments_], {
        stdio: [inputDescriptor ?? 'inherit', outputDescriptor ?? 'inherit', 'inherit'],
        env: process.env,
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`DOCKER_COMMAND_FAILED:${code ?? signal ?? 'unknown'}`));
      });
    });
  } finally {
    if (outputDescriptor !== undefined) closeSync(outputDescriptor);
    if (inputDescriptor !== undefined) closeSync(inputDescriptor);
  }
}

export async function runDockerCapture(arguments_) {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', [...productionComposeArguments(), ...arguments_], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: process.env,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) child.kill('SIGTERM');
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`DOCKER_COMMAND_FAILED:${code ?? signal ?? 'unknown'}`));
    });
  });
}

export function applicationServices() {
  return [
    'web',
    'api',
    'parser-worker',
    'parser-worker-dwg',
    'reranker-worker',
    'deployment-agent',
  ];
}

const allowedOperationServices = new Set([
  ...applicationServices(),
  'tika',
  'postgres',
  'redis',
  'chroma',
]);

export function operationServices() {
  const configured =
    process.env.NEXUS_KB_OPERATION_SERVICES ??
    productionFileEnvironment.NEXUS_KB_OPERATION_SERVICES;
  const services = configured
    ? [
        ...new Set(
          configured
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
    : [...allowedOperationServices];
  if (services.length < 1 || services.some((service) => !allowedOperationServices.has(service))) {
    throw new Error('NEXUS_KB_OPERATION_SERVICES_INVALID');
  }
  for (const required of ['api', 'parser-worker', 'tika', 'postgres', 'redis', 'chroma']) {
    if (!services.includes(required)) throw new Error(`OPERATION_SERVICE_REQUIRED:${required}`);
  }
  return services;
}
